output "hail_config" {
  value = {
    schemaVersion = 1
    domain        = var.domain
    bucketName    = aws_s3_bucket.emails.id
    region        = var.region
    layout        = "indexed-v1"
    roleArn       = local.external_iam ? var.external_reader_role_arn : length(var.reader_principal_arns) > 0 ? aws_iam_role.reader[0].arn : null
    ruleSetName   = local.rule_set_name
    ruleName      = local.rule_name
  }
}
output "verification_token" { value = aws_ses_domain_identity.receiver.verification_token }
output "mx_target" { value = "inbound-smtp.${var.region}.amazonaws.com" }
output "reader_policy_arn" { value = local.external_iam ? null : aws_iam_policy.reader[0].arn }
output "ingestion_queue_url" { value = aws_sqs_queue.ingestion.url }
output "dlq_url" { value = aws_sqs_queue.dlq.url }
output "dns_records" {
  value = [
    { name = var.domain, type = "MX", value = "10 inbound-smtp.${var.region}.amazonaws.com", ttl = 300 },
    { name = "_amazonses.${var.domain}", type = "TXT", value = aws_ses_domain_identity.receiver.verification_token, ttl = 300 }
  ]
}
