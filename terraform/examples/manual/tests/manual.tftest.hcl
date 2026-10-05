mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012", arn = "arn:aws:iam::123456789012:user/test", user_id = "test" }
  }
  mock_data "aws_partition" { defaults = { partition = "aws", dns_suffix = "amazonaws.com" } }
  mock_data "aws_region" { defaults = { name = "us-east-1" } }
}
variables {
  name                      = "hail-test"
  domain                    = "mail.example.test"
  zone_name                 = "example.test"
  region                    = "us-east-1"
  external_indexer_role_arn = "arn:aws:iam::123456789012:role/hail-test-indexer"
  external_reader_role_arn  = "arn:aws:iam::123456789012:role/hail-test-reader"
}
run "manual_outputs_only" {
  command = plan
  assert {
    condition     = output.dns_records[0].name == var.domain && output.dns_records[0].type == "MX" && output.dns_records[1].name == "_amazonses.${var.domain}" && output.dns_records[1].type == "TXT"
    error_message = "Manual mode must output only the exact MX and verification TXT records."
  }
  assert {
    condition     = output.hail_config.roleArn == var.external_reader_role_arn
    error_message = "External reader role must reach generated configuration."
  }
}
run "reject_apex" {
  command = plan
  variables { domain = "example.test" }
  expect_failures = [terraform_data.guard]
}
