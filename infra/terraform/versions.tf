terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state with real locking — never local state in production.
  backend "s3" {
    # bucket         = "serviceos-tfstate-<account-id>"   # configure via -backend-config
    # dynamodb_table = "serviceos-tfstate-locks"
    # region         = "ap-south-1"
    # encrypt        = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "serviceos"
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "serviceos"
    }
  }
}
