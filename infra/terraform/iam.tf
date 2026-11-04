# ServiceOS IAM (audit INFRA-08): execution roles (pull images + read
# secrets + write logs) and task roles (runtime permissions — S3 files,
# KMS unwrap). API, worker and web each get their OWN task role so runtime
# blast radius stays scoped to that process.

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --- Execution role (shared bootstrap permissions) -----------------------

resource "aws_iam_role" "execution" {
  name               = "${var.project}-${var.environment}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Read exactly the ServiceOS secrets — nothing else in the account.
resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-serviceos-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
      Resource  = [aws_secretsmanager_secret.db_migrate_url.arn, aws_secretsmanager_secret.db_app_url.arn, aws_secretsmanager_secret.db_worker_url.arn, aws_secretsmanager_secret.jwt_access.arn, aws_secretsmanager_secret.jwt_refresh.arn]
    }]
  })
}

# --- API task role: S3 file objects + KMS ---------------------------------

resource "aws_iam_role" "api_task" {
  name               = "${var.project}-${var.environment}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "api_files" {
  name = "serviceos-files"
  role = aws_iam_role.api_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:HeadObject"]
        Resource = ["${aws_s3_bucket.files.arn}/tenants/*"]
      },
      {
        Effect    = "Allow"
        Action    = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource  = [aws_kms_key.files.arn]
      }
    ]
  })
}

# --- Worker task role: database only (no S3 — the worker never touches files) ---

resource "aws_iam_role" "worker_task" {
  name               = "${var.project}-${var.environment}-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# --- Web task role: none needed (server-rendered only) --------------------

resource "aws_iam_role" "web_task" {
  name               = "${var.project}-${var.environment}-web-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# --- ECR repositories ------------------------------------------------------

resource "aws_ecr_repository" "api" {
  name                 = "${var.project}/api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "${var.project}/web"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 30 tagged images"
      action       = { type = "expire" }
      selection = {
        tagStatus     = "tagged"
        tagPrefixList = ["sha-", "v"]
        countType     = "imageCountMoreThan"
        countNumber   = 30
      }
    }]
  })
}
