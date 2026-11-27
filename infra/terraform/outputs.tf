output "alb_dns_name" {
  description = "Public ALB DNS — point app_domain/api_domain CNAMEs here"
  value       = aws_lb.main.dns_name
}

output "rds_endpoint" {
  description = "Private RDS endpoint (reachable from ECS tasks only)"
  value       = aws_db_instance.main.address
}

output "files_bucket" {
  value = aws_s3_bucket.files.id
}

output "backups_bucket" {
  value = aws_s3_bucket.backups.id
}

output "ecr_api_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecr_web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}
