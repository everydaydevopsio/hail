mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012", arn = "arn:aws:iam::123456789012:user/test", user_id = "test" }
  }
  mock_data "aws_partition" { defaults = { partition = "aws", dns_suffix = "amazonaws.com" } }
  mock_data "aws_region" { defaults = { name = "us-east-1" } }
}
mock_provider "cloudflare" {
  mock_data "cloudflare_zone" { defaults = { name = "example.test" } }
}
variables {
  name                      = "hail-test"
  domain                    = "mail.example.test"
  zone_name                 = "example.test"
  zone_id                   = "0123456789abcdef0123456789abcdef"
  region                    = "us-east-1"
  external_indexer_role_arn = "arn:aws:iam::123456789012:role/hail-test-indexer"
  external_reader_role_arn  = "arn:aws:iam::123456789012:role/hail-test-reader"
}
run "exact_records" {
  command = plan
  assert {
    condition     = cloudflare_dns_record.mx.zone_id == var.zone_id && cloudflare_dns_record.mx.name == var.domain && cloudflare_dns_record.mx.type == "MX" && cloudflare_dns_record.mx.priority == 10
    error_message = "Cloudflare MX must target the approved zone and name."
  }
  assert {
    condition     = cloudflare_dns_record.verification.zone_id == var.zone_id && cloudflare_dns_record.verification.name == "_amazonses.${var.domain}" && cloudflare_dns_record.verification.type == "TXT"
    error_message = "Cloudflare verification must target only the exact TXT record."
  }
}
run "reject_apex" {
  command = plan
  variables { domain = "example.test" }
  expect_failures = [terraform_data.guard]
}
