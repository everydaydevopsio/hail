mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012", arn = "arn:aws:iam::123456789012:user/test", user_id = "test" }
  }
  mock_data "aws_partition" { defaults = { partition = "aws", dns_suffix = "amazonaws.com" } }
  mock_data "aws_region" { defaults = { name = "us-east-1" } }
}
variables {
  domain = "mail.example.test"
  region = "us-east-1"
  name   = "hail-test"
}
run "safe_defaults" {
  command = plan
  assert {
    condition     = length(aws_ses_active_receipt_rule_set.receiver) == 0
    error_message = "Default configuration must not replace the active SES rule set."
  }
  assert {
    condition     = length(aws_iam_role.reader) == 0
    error_message = "Do not create a broadly trusted reader role by default."
  }
  assert {
    condition     = aws_sqs_queue.ingestion.visibility_timeout_seconds >= 6 * aws_lambda_function.indexer.timeout
    error_message = "SQS visibility must safely exceed the Lambda timeout."
  }
  assert {
    condition     = contains(aws_lambda_event_source_mapping.ingestion.function_response_types, "ReportBatchItemFailures")
    error_message = "Ingestion must enable partial-batch failure reporting."
  }
  assert {
    condition     = one(aws_ses_receipt_rule.receiver.s3_action).object_key_prefix == "incoming/"
    error_message = "SES storage prefix must match the indexer."
  }
  assert {
    condition     = output.hail_config.schemaVersion == 1 && output.hail_config.layout == "indexed-v1"
    error_message = "Terraform and the SDK must agree on the output contract."
  }
}
run "reuse_existing_rule_set" {
  command = plan
  variables { existing_rule_set_name = "shared-inbound" }
  assert {
    condition     = length(aws_ses_receipt_rule_set.receiver) == 0 && length(aws_ses_active_receipt_rule_set.receiver) == 0
    error_message = "Existing rule sets must not be recreated or activated."
  }
  assert {
    condition     = aws_ses_receipt_rule.receiver.rule_set_name == "shared-inbound"
    error_message = "The new receipt rule must join the existing set."
  }
}
run "explicit_activation" {
  command = plan
  variables { manage_rule_set_activation = true }
  assert {
    condition     = length(aws_ses_active_receipt_rule_set.receiver) == 1
    error_message = "Explicit activation must create exactly one activation resource."
  }
}
run "reject_shared_activation" {
  command = plan
  variables {
    existing_rule_set_name     = "shared-inbound"
    manage_rule_set_activation = true
  }
  expect_failures = [aws_ses_domain_identity.receiver]
}
run "reject_unknown_region" {
  command = plan
  variables { region = "unsupported-9" }
  expect_failures = [var.region]
}
run "reject_invalid_retention" {
  command = plan
  variables { retention_days = 0 }
  expect_failures = [var.retention_days]
}
