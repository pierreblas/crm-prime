import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const rows = await p.$queryRaw<Array<{ conversationId: string; content: string; n: bigint; first: Date; last: Date }>>`
    SELECT "conversationId", left(coalesce(content, type::text), 60) AS content, count(*) AS n, min("createdAt") AS first, max("createdAt") AS last
    FROM messages
    WHERE direction = 'OUTBOUND' AND author = 'AI' AND "createdAt" > now() - interval '30 days'
    GROUP BY "conversationId", left(coalesce(content, type::text), 60)
    HAVING count(*) > 1 AND max("createdAt") - min("createdAt") < interval '10 minutes'
    ORDER BY max("createdAt") DESC LIMIT 15`;
  for (const r of rows) console.log(r.conversationId, Number(r.n), JSON.stringify(r.content), r.first.toISOString(), "→", r.last.toISOString());
  console.log("total", rows.length);
  await p.$disconnect();
})();
