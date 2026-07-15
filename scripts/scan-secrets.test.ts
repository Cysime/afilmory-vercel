import { describe, expect, it } from "vitest";

import { findSecretFindings } from "./scan-secrets";

describe("secret scanner", () => {
  it("detects high-confidence provider tokens without returning their value", () => {
    const token = ["ghp_", "a".repeat(40)].join("");
    expect(findSecretFindings(`TOKEN=${token}`)).toEqual([
      { line: 1, rule: "github-token" },
    ]);
  });

  it("supports a narrow line-level allow marker for synthetic fixtures", () => {
    const token = ["AKIA", "A".repeat(16)].join("");
    expect(
      findSecretFindings(`${token} // secret-scan: allow -- synthetic test`),
    ).toEqual([]);
  });

  it("does not flag empty template assignments or ordinary prose", () => {
    expect(
      findSecretFindings(
        "REPO_TOKEN=\nUse a least-privilege repository token.",
      ),
    ).toEqual([]);
  });
});
