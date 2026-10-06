variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}
variable "region" {
  type = string
  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.region))
    error_message = "region must be an AWS region name."
  }
}
variable "name" {
  type = string
  validation {
    condition     = can(regex("^hail-[a-z0-9-]{1,24}$", var.name)) && length(var.name) <= 29
    error_message = "name must be a short, run-unique hail namespace."
  }
}
variable "domain" {
  type = string
  validation {
    condition     = var.domain != var.zone_name && endswith(var.domain, ".${var.zone_name}")
    error_message = "domain must be a dedicated subdomain of zone_name."
  }
}
variable "zone_name" { type = string }
variable "from_address" {
  type = string
  validation {
    condition     = can(regex("^[A-Za-z0-9._+-]+@", var.from_address)) && endswith(var.from_address, "@${var.domain}")
    error_message = "The synthetic sender must be an address on the run domain."
  }
}
variable "source_principal_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:iam::${var.account_id}:(user|role)/[A-Za-z0-9_+=,.@/-]+$", var.source_principal_arn))
    error_message = "Bootstrap trust must name an exact IAM user or role in account_id."
  }
}
variable "source_session_arn" {
  type        = string
  description = "Exact ARN returned by STS GetCallerIdentity for the bootstrap provider session."
}
variable "owner" { type = string }
variable "expires_at" {
  type = string
  validation {
    condition     = can(formatdate("YYYY-MM-DD'T'hh:mm:ss'Z'", var.expires_at))
    error_message = "expires_at must be a UTC timestamp."
  }
}
