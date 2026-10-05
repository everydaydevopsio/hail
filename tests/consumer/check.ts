import { Hail, type HailConfig } from "@everydaydevopsio/hail";
import { test, expect, visitAuthLink } from "@everydaydevopsio/hail/playwright";

const config: HailConfig = {
  schemaVersion: 1,
  domain: "mail.example.test",
  bucketName: "hail-test-bucket",
  region: "us-east-1",
  layout: "indexed-v1",
};
void new Hail(config).createInbox("consumer");
void test;
void expect;
void visitAuthLink;
