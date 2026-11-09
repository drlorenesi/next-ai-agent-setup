import { describe, expect, it } from "vitest"
import { formatCell } from "@/lib/db/db-types"

describe("formatCell", () => {
  it("maps null and undefined to null (SQL NULL)", () => {
    expect(formatCell(null)).toBeNull()
    expect(formatCell(undefined)).toBeNull()
  })

  it("serializes Date as ISO-8601", () => {
    expect(formatCell(new Date("2026-01-02T03:04:05.678Z"))).toBe(
      "2026-01-02T03:04:05.678Z"
    )
  })

  it("serializes Buffer as 0x-prefixed hex", () => {
    expect(formatCell(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe("0xdeadbeef")
  })

  it("JSON-encodes plain objects and arrays", () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}')
    expect(formatCell([1, "x"])).toBe('[1,"x"]')
  })

  it("passes big-number strings through untouched", () => {
    expect(formatCell("9223372036854775807")).toBe("9223372036854775807")
  })

  it("stringifies numbers, booleans and bigint", () => {
    expect(formatCell(42)).toBe("42")
    expect(formatCell(0)).toBe("0")
    expect(formatCell(false)).toBe("false")
    expect(formatCell(9007199254740993n)).toBe("9007199254740993")
  })
})
