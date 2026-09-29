variable "name" {
  type    = string
  default = "hail"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,31}$", var.name))
    error_message = "Use a lowercase resource name of 3-32 characters."
  }
}
variable "domain" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+[.][a-z]{2,63}$", var.domain)) && length(var.domain) <= 253
    error_message = "Use a dedicated lowercase test-email subdomain."
  }
}
variable "region" {
  type    = string
  default = "us-east-1"
  validation {
    condition     = contains(["us-east-1", "us-east-2", "us-west-2", "ca-central-1", "eu-west-1"], var.region)
    error_message = "This initial module supports us-east-1, us-east-2, us-west-2, ca-central-1, and eu-west-1. Validate receiving support before adding another region."
  }
}
variable "bucket_name" {
  type    = string
  default = null
}
variable "existing_rule_set_name" {
  type    = string
  default = null
}
variable "manage_rule_set_activation" {
  type        = bool
  default     = false
  description = "Explicitly opt in to changing the active SES rule set. Never enable for an existing/shared rule set."
}
variable "retention_days" {
  type    = number
  default = 3
  validation {
    condition     = var.retention_days >= 1 && var.retention_days <= 30 && floor(var.retention_days) == var.retention_days
    error_message = "Retention must be a whole number from 1 to 30 days."
  }
}
variable "reader_principal_arns" {
  type    = list(string)
  default = []
}
variable "tags" {
  type    = map(string)
  default = {}
}
