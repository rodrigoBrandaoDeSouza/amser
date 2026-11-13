import { execSync } from "node:child_process";

/** Cria (se preciso) e migra o banco de testes antes da suíte. */
export default function setup() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* CI */
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Defina TEST_DATABASE_URL (veja .env.example)");
  if (!/_test\b|_test\?/.test(url)) throw new Error("TEST_DATABASE_URL precisa apontar para um banco *_test");
  const admin = new URL(url);
  const dbName = admin.pathname.slice(1);
  admin.pathname = "/postgres";
  execSync(`node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient({datasourceUrl:'${admin}'});p.$executeRawUnsafe('CREATE DATABASE \\"${dbName}\\"').catch(()=>{}).finally(()=>p.$disconnect())"`, { stdio: "inherit" });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
