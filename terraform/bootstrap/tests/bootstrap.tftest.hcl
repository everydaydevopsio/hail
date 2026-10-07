mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "520473892387", arn = "arn:aws:iam::520473892387:user/marka", user_id = "test" }
  }
  mock_data "aws_partition" { defaults = { partition = "aws", dns_suffix = "amazonaws.com" } }
  mock_data "aws_region" { defaults = { region = "us-east-1" } }
}

variables {
  account_id           = "520473892387"
  region               = "us-east-1"
  name                 = "hail-20261005-202402"
  domain               = "hail-20261005-202402.markcallen.dev"
  zone_name            = "markcallen.dev"
  from_address         = "sender@hail-20261005-202402.markcallen.dev"
  source_principal_arn = "arn:aws:iam::520473892387:user/marka"
  source_session_arn   = "arn:aws:iam::520473892387:user/marka"
  owner                = "marka"
  expires_at           = "2026-10-07T20:24:02Z"
}

run "separate_bounded_roles" {
  command = plan
  assert {
    condition     = aws_iam_role.provisioner.permissions_boundary == local.policy_arns.provisioner && aws_iam_role.reader.permissions_boundary == local.policy_arns.reader && aws_iam_role.sender.permissions_boundary == local.policy_arns.sender && aws_iam_role.indexer.permissions_boundary == local.policy_arns.indexer
    error_message = "Every operational role must have its own matching permissions boundary."
  }
  assert {
    condition     = jsondecode(aws_iam_role.indexer.assume_role_policy).Statement[0].Principal.Service == "lambda.amazonaws.com"
    error_message = "Only Lambda may assume the indexer role."
  }
  assert {
    condition     = jsondecode(aws_iam_role.provisioner.assume_role_policy).Statement[0].Principal.AWS == var.source_principal_arn
    error_message = "Only the approved source principal may bootstrap a provisioner session."
  }
  assert {
    condition     = aws_iam_role.provisioner.tags.RunId == var.name && aws_iam_role.sender.tags.ExpiresAt == var.expires_at
    error_message = "Operational roles must carry run ownership and expiry tags."
  }
}

run "sender_envelope_scope" {
  command = plan
  assert {
    condition     = jsondecode(aws_iam_policy.sender.policy).Statement[0].Resource == "arn:aws:ses:us-east-1:520473892387:identity/hail-20261005-202402.markcallen.dev"
    error_message = "Sender must use only the approved SES identity."
  }
  assert {
    condition     = jsondecode(aws_iam_policy.sender.policy).Statement[0].Condition.StringEquals["ses:FromAddress"] == var.from_address && jsondecode(aws_iam_policy.sender.policy).Statement[0].Condition["ForAllValues:StringLike"]["ses:Recipients"] == ["*@${var.domain}"]
    error_message = "Sender must restrict FromAddress and every envelope recipient."
  }
}

run "passrole_is_exact" {
  command = plan
  assert {
    condition     = jsondecode(aws_iam_policy.provisioner.policy).Statement[0].Resource == "arn:aws:iam::520473892387:role/hail-20261005-202402-indexer" && jsondecode(aws_iam_policy.provisioner.policy).Statement[0].Condition.StringEquals["iam:PassedToService"] == "lambda.amazonaws.com"
    error_message = "Provisioner PassRole must name only the indexer role and Lambda service."
  }
}

run "provider_readback_permissions" {
  command = plan
  assert {
    condition     = alltrue([for action in ["s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketWebsite", "s3:GetAccelerateConfiguration", "s3:GetBucketRequestPayment", "s3:GetBucketLogging", "s3:GetReplicationConfiguration", "s3:GetBucketObjectLockConfiguration"] : contains(one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Action if s.Sid == "OwnBucket"]), action)])
    error_message = "The AWS S3 bucket provider must be able to read back each configuration it inspects on the run bucket."
  }
  assert {
    condition     = contains(one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Action if s.Sid == "OwnTopic"]), "sns:GetSubscriptionAttributes") && contains(one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Action if s.Sid == "OwnTopic"]), "sns:SetSubscriptionAttributes")
    error_message = "The AWS SNS subscription provider must read and set attributes on the run topic."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Resource if s.Sid == "OwnLogGroup"]) == "arn:aws:logs:us-east-1:520473892387:log-group:/aws/lambda/hail-20261005-202402-indexer"
    error_message = "Log group tag reads require the exact log group ARN without a stream suffix."
  }
  assert {
    condition     = alltrue([for action in ["lambda:ListVersionsByFunction", "lambda:GetFunctionCodeSigningConfig"] : contains(one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Action if s.Sid == "OwnFunction"]), action)])
    error_message = "The pinned Lambda provider reads function versions and code signing configuration."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Resource if s.Sid == "ReadMappingTags"]) == "arn:aws:lambda:us-east-1:520473892387:event-source-mapping:*"
    error_message = "Mapping tag readback must stay in the approved account and region."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Resource if s.Sid == "ReadRegionalMapping"]) == "*" && one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Condition.StringEquals["aws:RequestedRegion"] if s.Sid == "ReadRegionalMapping"]) == var.region && !contains(one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Action if s.Sid == "ManageOwnMapping"]), "lambda:GetEventSourceMapping")
    error_message = "Terraform teardown polling needs a regional read when the deleted mapping no longer has an ARN."
  }
  assert {
    condition     = contains(one([for s in jsondecode(aws_iam_policy.provisioner.policy).Statement : s.Action if s.Sid == "OwnSesRegion"]), "ses:DescribeReceiptRule")
    error_message = "The SES receipt rule provider must read back its newly created rule."
  }
}

run "reject_other_account" {
  command = plan
  variables {
    account_id           = "111111111111"
    source_principal_arn = "arn:aws:iam::111111111111:user/marka"
  }
  expect_failures = [terraform_data.identity_guard]
}

run "reject_unexpected_source_session" {
  command = plan
  variables { source_session_arn = "arn:aws:iam::520473892387:user/other" }
  expect_failures = [terraform_data.identity_guard]
}

run "reject_unapproved_sender" {
  command = plan
  variables { from_address = "sender@unrelated.example" }
  expect_failures = [var.from_address]
}
