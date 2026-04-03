// src/app/api/phone-lines/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const lines = await prisma.phoneLine.findMany({ where: { isActive: true }, orderBy: { label: "asc" } });
  return NextResponse.json(lines);
}
