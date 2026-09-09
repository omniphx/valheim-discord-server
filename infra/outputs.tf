output "interactions_endpoint" { value = "${aws_apigatewayv2_api.discord.api_endpoint}/interactions" }
output "instance_id" { value = aws_instance.game.id }
output "world_volume_id" { value = aws_ebs_volume.world.id }
output "region" { value = var.region }
output "session_command" { value = "aws ssm start-session --region ${var.region} --target ${aws_instance.game.id}" }
