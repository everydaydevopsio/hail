mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012", arn = "arn:aws:iam::123456789012:user/test", user_id = "test" }
  }
  mock_data "aws_partition" { defaults = { partition = "aws", dns_suffix = "amazonaws.com" } }
  mock_data "aws_region" { defaults = { name = "us-east-1" } }
  mock_data "aws_route53_zone" { defaults = { name = "example.test.", private_zone = false } }
}
variables {
  name                      = "hail-test"
  domain                    = "mail.example.test"
  zone_name                 = "example.test"
  zone_id                   = "ZTEST123"
  region                    = "us-east-1"
  external_indexer_role_arn = "arn:aws:iam::123456789012:role/hail-test-indexer"
  external_reader_role_arn  = "arn:aws:iam::123456789012:role/hail-test-reader"
}
run "exact_records_no_overwrite" {
  command = plan
  assert {
    condition     = aws_route53_record.mx.zone_id == var.zone_id && aws_route53_record.mx.name == var.domain && aws_route53_record.mx.type == "MX" && !aws_route53_record.mx.allow_overwrite
    error_message = "Route53 MX must target the approved name and zone without overwriting."
  }
  assert {
    condition     = aws_route53_record.verification.zone_id == var.zone_id && aws_route53_record.verification.name == "_amazonses.${var.domain}" && aws_route53_record.verification.type == "TXT" && !aws_route53_record.verification.allow_overwrite
    error_message = "Route53 verification must target only the exact TXT record."
  }
}
run "reject_apex" {
  command = plan
  variables { domain = "example.test" }
  expect_failures = [terraform_data.guard]
}
