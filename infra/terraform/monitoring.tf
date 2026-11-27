# ServiceOS monitoring + alarms (audit INFRA-07): CloudWatch alarms on the
# load balancer, database and service health. The application-level worker
# liveness is exposed at GET /health/worker (heartbeat freshness) — wire an
# external uptime check (CloudWatch Synthetics canary, see below) to alarm
# when the background pipeline stalls.

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.project}-${var.environment}-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
  alarm_description = "API 5xx responses elevated"
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${var.project}-${var.environment}-db-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  alarm_description = "RDS CPU sustained above 80%"
}

resource "aws_cloudwatch_metric_alarm" "db_storage" {
  alarm_name          = "${var.project}-${var.environment}-db-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5 * 1024 * 1024 * 1024 # 5 GiB
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  alarm_description = "RDS free storage below 5 GiB (max_allocated_storage autoscaling headroom check)"
}

resource "aws_cloudwatch_metric_alarm" "db_connections" {
  alarm_name          = "${var.project}-${var.environment}-db-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 160
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  alarm_description = "Connection count approaching instance limits — review pool sizing"
}

# Worker service health (ECS-level): a stopped worker means stalled outbox
# dispatch and delayed renewal reminders — also visible via /health/worker.
resource "aws_cloudwatch_metric_alarm" "worker_service_healthy" {
  alarm_name          = "${var.project}-${var.environment}-worker-running"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Average"
  threshold           = 1
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.worker.name
  }
  alarm_description = "Background worker has no running tasks"
}

# Synthetics canary hitting the worker heartbeat endpoint (application-level
# monitoring for the background pipeline — INFRA-07).
resource "aws_synthetics_canary" "worker_heartbeat" {
  name                 = "${var.project}-${var.environment}-worker-heartbeat"
  artifact_s3_location = "s3://${aws_s3_bucket.backups.id}/synthetics/"
  execution_role_arn   = aws_iam_role.execution.arn
  runtime_version      = "synthetics-nodejs-latest"
  schedule {
    expression = "rate(1 minute)"
  }
  run_config {
    timeout_in_seconds = 60
  }
  # Minimal canary: fetch https://<api-domain>/health/worker and fail unless
  # the payload reports healthy=true.
  script = <<-EOT
    const synthetics = require('Synthetics');
    exports.handler = async () => {
      const res = await synthetics.executeHttpStep('workerHeartbeat', 'https://${var.api_domain}/health/worker');
      if (!res.body || !res.body.includes('"healthy":true')) {
        throw new Error('ServiceOS worker heartbeat unhealthy: ' + res.body);
      }
    };
  EOT
}
