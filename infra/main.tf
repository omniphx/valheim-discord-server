terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
}
provider "aws" {
  region = var.region
  default_tags { tags = { Project = var.name, ManagedBy = "terraform" } }
}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_availability_zones" "available" { state = "available" }
data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}
locals {
  arn_prefix = "arn:${data.aws_partition.current.partition}"
  account    = data.aws_caller_identity.current.account_id
}
resource "aws_vpc" "game" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
}
resource "aws_subnet" "game" {
  vpc_id                  = aws_vpc.game.id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
}
resource "aws_internet_gateway" "game" { vpc_id = aws_vpc.game.id }
resource "aws_route_table" "game" {
  vpc_id = aws_vpc.game.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.game.id
  }
}
resource "aws_route_table_association" "game" {
  subnet_id      = aws_subnet.game.id
  route_table_id = aws_route_table.game.id
}
resource "aws_security_group" "game" {
  name_prefix = "${var.name}-"
  vpc_id      = aws_vpc.game.id
  ingress {
    description = "Valheim game and query UDP"
    from_port   = 2456
    to_port     = 2457
    protocol    = "udp"
    cidr_blocks = var.allowed_game_cidrs
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_iam_role" "vm" {
  name               = "${var.name}-vm"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.vm.name
  policy_arn = "${local.arn_prefix}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "password" {
  role   = aws_iam_role.vm.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["ssm:GetParameter"], Resource = "${local.arn_prefix}:ssm:${var.region}:${local.account}:parameter${var.password_parameter_name}" }] })
}
resource "aws_iam_instance_profile" "vm" { role = aws_iam_role.vm.name }
resource "aws_ebs_volume" "world" {
  availability_zone = aws_subnet.game.availability_zone
  size              = var.world_disk_gb
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${var.name}-world" }
  lifecycle { prevent_destroy = true }
}
resource "aws_instance" "game" {
  ami                                  = data.aws_ssm_parameter.ami.value
  instance_type                        = var.instance_type
  subnet_id                            = aws_subnet.game.id
  vpc_security_group_ids               = [aws_security_group.game.id]
  iam_instance_profile                 = aws_iam_instance_profile.vm.name
  instance_initiated_shutdown_behavior = "stop"
  disable_api_termination              = true
  user_data_replace_on_change          = true
  credit_specification { cpu_credits = "standard" }
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_size = 16
    volume_type = "gp3"
    encrypted   = true
  }
  user_data = templatefile("${path.module}/cloud-init.sh.tftpl", {
    volume_id            = replace(aws_ebs_volume.world.id, "-", "")
    region               = var.region, password_parameter = var.password_parameter_name
    server_name          = var.server_name, world_name = var.world_name
    crossplay            = var.crossplay, container_image = var.container_image
    allow_portal_items   = var.allow_portal_items
    double_resources     = var.double_resources
    casual_death_penalty = var.casual_death_penalty
    less_raids           = var.less_raids
  })
  tags       = { Name = var.name }
  depends_on = [aws_route_table_association.game, aws_iam_role_policy.password, aws_iam_role_policy_attachment.ssm]
  lifecycle {
    prevent_destroy = true
    # cloud-init runs only on first launch. Existing hosts load /etc/valheim.env.
    ignore_changes = [ami, user_data]
  }
}
resource "aws_volume_attachment" "world" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.world.id
  instance_id = aws_instance.game.id
}

data "archive_file" "controller" {
  type        = "zip"
  source_dir  = "${path.module}/../dist"
  output_path = "${path.module}/controller.zip"
}
resource "aws_iam_role" "lambda" {
  for_each           = toset(["receiver", "worker"])
  name               = "${var.name}-${each.key}"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = toset(["receiver", "worker"])
  name              = "/aws/lambda/${var.name}-${each.key}"
  retention_in_days = 14
}
resource "aws_iam_role_policy" "logs" {
  for_each = aws_iam_role.lambda
  role     = each.value.id
  policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.lambda[each.key].arn}:*" }] })
}
resource "aws_ssm_document" "join_code" {
  name            = "${var.name}-join-code"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Read Valheim crossplay join code; no caller-supplied commands or parameters."
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "joinCode"
      inputs = {
        timeoutSeconds = "20"
        runCommand     = ["python3 - <<'VALHEIM_JOIN_CODE'\n${file("${path.module}/../scripts/join-code.py")}\nVALHEIM_JOIN_CODE"]
      }
    }]
  })
}
resource "aws_iam_role_policy" "worker" {
  role = aws_iam_role.lambda["worker"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ec2:DescribeInstances"], Resource = "*" },
    { Effect = "Allow", Action = ["ec2:StartInstances", "ec2:StopInstances"], Resource = aws_instance.game.arn },
    { Effect = "Allow", Action = ["ssm:SendCommand"], Resource = [aws_instance.game.arn, aws_ssm_document.join_code.arn] },
    { Effect = "Allow", Action = ["ssm:GetCommandInvocation"], Resource = "*" }
  ] })
}
resource "aws_iam_role_policy" "receiver" {
  role   = aws_iam_role.lambda["receiver"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.worker.arn }] })
}
resource "aws_lambda_function" "worker" {
  function_name    = "${var.name}-worker"
  role             = aws_iam_role.lambda["worker"].arn
  handler          = "worker.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.controller.output_path
  source_code_hash = data.archive_file.controller.output_base64sha256
  timeout          = 60
  memory_size      = 256
  environment { variables = { INSTANCE_ID = aws_instance.game.id, DISCORD_APPLICATION_ID = var.discord_application_id, JOIN_CODE_DOCUMENT = aws_ssm_document.join_code.name } }
  depends_on = [aws_iam_role_policy.logs, aws_iam_role_policy.worker]
}
resource "aws_lambda_function_event_invoke_config" "worker" {
  function_name                = aws_lambda_function.worker.function_name
  maximum_event_age_in_seconds = 60
  maximum_retry_attempts       = 0
}
resource "aws_lambda_function" "receiver" {
  function_name    = "${var.name}-receiver"
  role             = aws_iam_role.lambda["receiver"].arn
  handler          = "receiver.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.controller.output_path
  source_code_hash = data.archive_file.controller.output_base64sha256
  timeout          = 3
  memory_size      = 256
  environment {
    variables = {
      DISCORD_PUBLIC_KEY     = var.discord_public_key
      DISCORD_APPLICATION_ID = var.discord_application_id
      DISCORD_GUILD_ID       = var.discord_guild_id
      ALLOWED_ROLE_IDS       = join(",", sort(tolist(var.allowed_role_ids)))
      WORKER_FUNCTION_NAME   = aws_lambda_function.worker.function_name
    }
  }
  depends_on = [aws_iam_role_policy.logs, aws_iam_role_policy.receiver]
}
resource "aws_apigatewayv2_api" "discord" {
  name          = "${var.name}-discord"
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "discord" {
  api_id                 = aws_apigatewayv2_api.discord.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.receiver.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "discord" {
  api_id    = aws_apigatewayv2_api.discord.id
  route_key = "POST /interactions"
  target    = "integrations/${aws_apigatewayv2_integration.discord.id}"
}
resource "aws_apigatewayv2_stage" "discord" {
  api_id      = aws_apigatewayv2_api.discord.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
}
resource "aws_lambda_permission" "gateway" {
  statement_id  = "AllowDiscordGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.receiver.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.discord.execution_arn}/*/POST/interactions"
}
