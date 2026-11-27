variable "region" {
  description = "AWS region for the ServiceOS production stack"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Environment name (prod, staging)"
  type        = string
  default     = "prod"
}

variable "project" {
  description = "Resource name prefix"
  type        = string
  default     = "serviceos"
}

variable "app_domain" {
  description = "Public domain for the web console (Caddy/ALB certificate)"
  type        = string
}

variable "api_domain" {
  description = "Public domain for the API (defaults to api.<app_domain> pattern owner-provided)"
  type        = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "az_count" {
  description = "Availability zones to spread across (2 minimum for RDS Multi-AZ)"
  type        = number
  default     = 2
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_multi_az" {
  description = "RDS Multi-AZ standby for failover"
  type        = bool
  default     = true
}

variable "db_backup_retention_days" {
  description = "Automated snapshot retention (PITR window)"
  type        = number
  default     = 14
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "worker_cpu" {
  type    = number
  default = 256
}

variable "worker_memory" {
  type    = number
  default = 512
}

variable "web_cpu" {
  type    = number
  default = 512
}

variable "web_memory" {
  type    = number
  default = 1024
}

variable "api_image" {
  description = "ECR image tag for api+worker (set by CI, e.g. 123456789012.dkr.ecr.../serviceos-api:sha)"
  type        = string
}

variable "web_image" {
  description = "ECR image tag for the web console"
  type        = string
}

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "allowed_ingress_cidrs" {
  description = "CIDRs allowed to reach the public ALB (IPv4)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
