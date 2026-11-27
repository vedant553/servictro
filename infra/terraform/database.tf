# ServiceOS production database (audit INFRA-06/08): RDS PostgreSQL 17,
# storage encryption, automated backups + PITR window, Multi-AZ standby,
# deletion protection, private-subnet-only placement.

resource "random_password" "db_master" {
  length  = 24
  special = false
}

resource "random_password" "db_migrate" {
  length  = 24
  special = false
}

resource "random_password" "db_app" {
  length  = 24
  special = false
}

resource "random_password" "db_worker" {
  length  = 24
  special = false
}

resource "random_password" "jwt_access" {
  length  = 48
  special = false
}

resource "random_password" "jwt_refresh" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-${var.environment}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "main" {
  name   = "${var.project}-${var.environment}-pg17"
  family = "postgres17"

  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_disconnections"
    value = "1"
  }
  # pg_stat_statements for performance insights queries
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-${var.environment}"
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  allocated_storage     = 50
  max_allocated_storage = 200
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "serviceos"
  username = "serviceos_master"
  password = random_password.db_master.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false

  multi_az               = var.db_multi_az
  backup_retention_period = var.db_backup_retention_days
  backup_window          = "20:30-21:30"   # low-traffic IST window
  maintenance_window     = "sun:22:00-sun:23:00"
  copy_tags_to_snapshot  = true
  deletion_protection    = var.db_deletion_protection
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.project}-${var.environment}-final"

  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = { Name = "${var.project}-${var.environment}-db" }
}

# One-off bootstrap: provision the three least-privilege LOGIN roles on the
# fresh instance. Re-run `scripts/db-bootstrap-roles.sql` manually as master
# after the first apply if you change passwords in Secrets Manager.
locals {
  db_host = aws_db_instance.main.address
  db_port = aws_db_instance.main.port

  db_migrate_url = "postgresql://serviceos_migrate:${random_password.db_migrate.result}@${local.db_host}:${local.db_port}/serviceos"
  db_app_url     = "postgresql://serviceos_app:${random_password.db_app.result}@${local.db_host}:${local.db_port}/serviceos"
  db_worker_url  = "postgresql://serviceos_worker:${random_password.db_worker.result}@${local.db_host}:${local.db_port}/serviceos"
}

# Credential separation (audit INFRA-08): each process role gets its OWN
# secret, rotatable independently; nobody shares the master.
resource "aws_secretsmanager_secret" "db_master" {
  name = "${var.project}/${var.environment}/db/master"
}

resource "aws_secretsmanager_secret_version" "db_master" {
  secret_id     = aws_secretsmanager_secret.db_master.id
  secret_string = random_password.db_master.result
}

resource "aws_secretsmanager_secret" "db_migrate_url" {
  name = "${var.project}/${var.environment}/db/migrate-url"
}

resource "aws_secretsmanager_secret_version" "db_migrate_url" {
  secret_id     = aws_secretsmanager_secret.db_migrate_url.id
  secret_string = local.db_migrate_url
}

resource "aws_secretsmanager_secret" "db_app_url" {
  name = "${var.project}/${var.environment}/db/app-url"
}

resource "aws_secretsmanager_secret_version" "db_app_url" {
  secret_id     = aws_secretsmanager_secret.db_app_url.id
  secret_string = local.db_app_url
}

resource "aws_secretsmanager_secret" "db_worker_url" {
  name = "${var.project}/${var.environment}/db/worker-url"
}

resource "aws_secretsmanager_secret_version" "db_worker_url" {
  secret_id     = aws_secretsmanager_secret.db_worker_url.id
  secret_string = local.db_worker_url
}

resource "aws_secretsmanager_secret" "jwt_access" {
  name = "${var.project}/${var.environment}/jwt/access-secret"
}

resource "aws_secretsmanager_secret_version" "jwt_access" {
  secret_id     = aws_secretsmanager_secret.jwt_access.id
  secret_string = random_password.jwt_access.result
}

resource "aws_secretsmanager_secret" "jwt_refresh" {
  name = "${var.project}/${var.environment}/jwt/refresh-secret"
}

resource "aws_secretsmanager_secret_version" "jwt_refresh" {
  secret_id     = aws_secretsmanager_secret.jwt_refresh.id
  secret_string = random_password.jwt_refresh.result
}

resource "aws_security_group" "db" {
  name        = "${var.project}-${var.environment}-db"
  description = "ServiceOS database — Postgres from ECS tasks only"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = local.db_port
    to_port         = local.db_port
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
