terraform {
  required_version = ">= 1.7, < 2.0"
  required_providers {
    aws        = { source = "hashicorp/aws", version = ">= 5.50, < 7.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.0" }
  }
}
provider "aws" { region = var.region }
# Reads CLOUDFLARE_API_TOKEN from the environment. Do not put it in tfvars.
provider "cloudflare" {}
variable "name" { type = string }
variable "domain" { type = string }
variable "zone_name" { type = string }
variable "zone_id" { type = string }
variable "region" { type = string }
variable "existing_rule_set_name" {
  type    = string
  default = null
}
variable "manage_rule_set_activation" {
  type    = bool
  default = false
}
variable "retention_days" {
  type    = number
  default = 3
}
variable "reader_principal_arns" {
  type    = list(string)
  default = []
}
variable "external_indexer_role_arn" {
  type    = string
  default = null
}
variable "external_reader_role_arn" {
  type    = string
  default = null
}
variable "permissions_boundary_arn" {
  type    = string
  default = null
}
variable "tags" {
  type    = map(string)
  default = {}
}
data "cloudflare_zone" "selected" { zone_id = var.zone_id }
resource "terraform_data" "guard" {
  input = var.domain
  lifecycle {
    precondition {
      condition     = data.cloudflare_zone.selected.name == var.zone_name && var.domain != var.zone_name && endswith(var.domain, ".${var.zone_name}")
      error_message = "Use a dedicated subdomain of the selected existing zone; never the zone apex."
    }
  }
}
module "receiver" {
  source                     = "../../modules/receiver"
  name                       = var.name
  domain                     = var.domain
  region                     = var.region
  existing_rule_set_name     = var.existing_rule_set_name
  manage_rule_set_activation = var.manage_rule_set_activation
  retention_days             = var.retention_days
  reader_principal_arns      = var.reader_principal_arns
  external_indexer_role_arn  = var.external_indexer_role_arn
  external_reader_role_arn   = var.external_reader_role_arn
  permissions_boundary_arn   = var.permissions_boundary_arn
  tags                       = var.tags
  depends_on                 = [terraform_data.guard]
}
resource "cloudflare_dns_record" "mx" {
  zone_id  = var.zone_id
  name     = var.domain
  type     = "MX"
  content  = module.receiver.mx_target
  priority = 10
  ttl      = 300
}
resource "cloudflare_dns_record" "verification" {
  zone_id = var.zone_id
  name    = "_amazonses.${var.domain}"
  type    = "TXT"
  content = module.receiver.verification_token
  ttl     = 300
}
resource "aws_ses_domain_identity_verification" "receiver" {
  domain     = var.domain
  depends_on = [cloudflare_dns_record.mx, cloudflare_dns_record.verification]
}
output "hail_config" { value = module.receiver.hail_config }
output "dns_records" { value = module.receiver.dns_records }
output "reader_policy_arn" { value = module.receiver.reader_policy_arn }
output "dlq_url" { value = module.receiver.dlq_url }
