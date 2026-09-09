mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-2a"] }
  }
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
}
mock_provider "archive" {}
variables {
  discord_application_id = "123456789012345678"
  discord_public_key     = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  discord_guild_id       = "234567890123456789"
  allowed_role_ids       = ["345678901234567890"]
}
run "safe_default_plan" {
  command = plan
  assert {
    condition     = aws_instance.game.instance_initiated_shutdown_behavior == "stop" && aws_instance.game.disable_api_termination
    error_message = "The VM must stop on shutdown and resist accidental termination."
  }
  assert {
    condition     = aws_ebs_volume.world.encrypted && aws_ebs_volume.world.size == 30
    error_message = "World data needs a separate encrypted disk."
  }
  assert {
    condition     = aws_instance.game.credit_specification[0].cpu_credits == "standard"
    error_message = "Do not enable surplus CPU credit billing by default."
  }
  assert {
    condition     = aws_instance.game.metadata_options[0].http_tokens == "required"
    error_message = "Require IMDSv2."
  }
  assert {
    condition     = aws_lambda_function_event_invoke_config.worker.maximum_retry_attempts == 0
    error_message = "Do not retry old lifecycle actions on asynchronous worker errors."
  }
}
run "reject_empty_roles" {
  command = plan
  variables { allowed_role_ids = [] }
  expect_failures = [var.allowed_role_ids]
}
run "reject_arm_instance" {
  command = plan
  variables { instance_type = "t4g.large" }
  expect_failures = [var.instance_type]
}
