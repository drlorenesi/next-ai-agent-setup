import { describe, expect, it } from "vitest"
import { isEmailAllowed, parseAllowedDomains } from "@/lib/auth-allowlist"

describe("parseAllowedDomains", () => {
  it("returns an empty list for undefined or blank input", () => {
    expect(parseAllowedDomains(undefined)).toEqual([])
    expect(parseAllowedDomains("")).toEqual([])
    expect(parseAllowedDomains(" , ,")).toEqual([])
  })

  it("trims, lowercases and strips the leading @", () => {
    expect(parseAllowedDomains(" @MyCompany1.com ,@mycompany2.com")).toEqual([
      "mycompany1.com",
      "mycompany2.com",
    ])
  })

  it("drops malformed entries", () => {
    expect(
      parseAllowedDomains("mycompany1.com,@,@nodot,user@mycompany2.com,@ok.es,@*.com"),
    ).toEqual(["ok.es"])
  })
})

describe("isEmailAllowed", () => {
  const domains = parseAllowedDomains("@mycompany1.com,@mycompany2.com")

  it("allows exact domain matches, case-insensitively", () => {
    expect(isEmailAllowed("ana@mycompany1.com", domains)).toBe(true)
    expect(isEmailAllowed("  Ana@MyCompany2.COM ", domains)).toBe(true)
  })

  it("rejects other domains and lookalikes", () => {
    expect(isEmailAllowed("ana@gmail.com", domains)).toBe(false)
    expect(isEmailAllowed("ana@evilmycompany1.com", domains)).toBe(false)
    expect(isEmailAllowed("ana@x.mycompany1.com", domains)).toBe(false)
    expect(isEmailAllowed("ana@mycompany1.com.evil.io", domains)).toBe(false)
  })

  it("uses the part after the last @", () => {
    expect(isEmailAllowed("a@mycompany1.com@gmail.com", domains)).toBe(false)
    expect(isEmailAllowed("a@gmail.com@mycompany1.com", domains)).toBe(true)
  })

  it("rejects malformed emails", () => {
    expect(isEmailAllowed("", domains)).toBe(false)
    expect(isEmailAllowed("@mycompany1.com", domains)).toBe(false)
    expect(isEmailAllowed("ana@", domains)).toBe(false)
    expect(isEmailAllowed("ana", domains)).toBe(false)
  })

  it("fails closed with an empty list", () => {
    expect(isEmailAllowed("ana@mycompany1.com", [])).toBe(false)
  })
})
