import { describe, expect, it } from "vitest";
import { generateSecret, hotp, totp, verifyTotp } from "@/lib/auth/totp";
import { can, staffPermissions } from "@/lib/auth/permissions";
import { parseCsv } from "@/lib/crm";

describe("TOTP (RFC 6238)", () => {
  // Segredo de teste da RFC: ASCII "12345678901234567890" em base32.
  const RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it("vetores oficiais (SHA-1, 6 dígitos = últimos 6 dos 8 da RFC)", () => {
    expect(totp(RFC, 59_000)).toBe("287082");
    expect(totp(RFC, 1111111109_000)).toBe("081804");
    expect(totp(RFC, 2000000000_000)).toBe("279037");
    expect(hotp(RFC, 0)).toBe("755224"); // RFC 4226
  });
  it("aceita ±1 passo e recusa códigos errados", () => {
    const s = generateSecret();
    const now = Date.now();
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now + 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 120_000), now)).toBe(false);
    expect(verifyTotp(s, "abc123", now)).toBe(false);
  });
});

describe("permissões da equipe", () => {
  it("dono pode tudo; staff segue o padrão + o que for marcado", () => {
    expect(can({ role: "owner", permissionsJson: {} }, "viewReports")).toBe(true);
    expect(can({ role: "staff", permissionsJson: {} }, "manageBookings")).toBe(true);
    expect(can({ role: "staff", permissionsJson: {} }, "viewCustomers")).toBe(false);
    expect(can({ role: "staff", permissionsJson: { viewCustomers: true, manageBookings: false } }, "viewCustomers")).toBe(true);
    expect(staffPermissions({ manageBookings: "sim" }).manageBookings).toBe(true); // valor inválido → padrão
  });
});

describe("CSV", () => {
  it("vírgula ou ponto e vírgula, aspas e BOM", () => {
    expect(parseCsv('﻿nome;telefone\n"Silva; Ana";11988887777\r\nBia;11977776666')).toEqual([
      ["nome", "telefone"],
      ["Silva; Ana", "11988887777"],
      ["Bia", "11977776666"],
    ]);
    expect(parseCsv('a,b\n"x ""y""",2')).toEqual([["a", "b"], ['x "y"', "2"]]);
  });
});
