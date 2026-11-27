/**
 * Asistente de bienvenida: parte pura (sin modelo ni base de datos).
 *
 *   npm run test:setup --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_TYPES, businessSetupSchema, welcomeMessageFor, type AgentToolInfo, type BusinessSetupInput } from "@crm/shared";
import {
  businessHoursFor,
  composeBrief,
  knowledgeDoc,
  localAgentPrompt,
  normalizeWebsite,
  quickRepliesFor,
  stagePlan,
  toolsForGoal,
} from "../src/modules/ai/business-setup.rules";

const FACTORY = ["Entrantes", "Contactado", "Calificado", "Propuesta", "Ganado", "Perdido"];

const base = (over: Partial<BusinessSetupInput> = {}): BusinessSetupInput =>
  businessSetupSchema.parse({ businessType: "tienda", agentName: "Sofía", goal: "vender", tone: "cercano", ...over });

const tool = (name: string, unavailableReason: string | null = null): AgentToolInfo => ({
  name,
  label: name,
  description: name,
  isAction: false,
  unavailableReason,
});

test("las herramientas son las de su misión que se pueden usar hoy, más las básicas", () => {
  const available = [
    tool("search_contact"),
    tool("search_knowledge"),
    tool("search_products"),
    tool("handoff_to_human"),
    tool("update_contact"),
    tool("mark_lead"),
    tool("add_tag", "No hay etiquetas"),
    tool("assign_to_seller"),
  ];
  const vender = toolsForGoal("vender", available);
  assert.ok(vender.includes("search_products"));
  assert.ok(vender.includes("handoff_to_human"));
  assert.ok(!vender.includes("add_tag"), "una herramienta no disponible no se activa");
  assert.ok(!vender.includes("assign_to_seller"), "no es de la misión vender");
  assert.ok(!toolsForGoal("agendar", available).includes("search_products"));
});

test("el embudo toma las etapas del rubro solo si nadie las cambió", () => {
  assert.deepEqual(stagePlan(FACTORY, "tienda", FACTORY), [...BUSINESS_TYPES.tienda.stages!]);
  // De un rubro del asistente a otro: se puede rehacer.
  assert.deepEqual(stagePlan([...BUSINESS_TYPES.tienda.stages!], "salud", FACTORY), [...BUSINESS_TYPES.salud.stages!]);
  // «Otro» vuelve a las de fábrica.
  assert.deepEqual(stagePlan([...BUSINESS_TYPES.salud.stages!], "otro", FACTORY), FACTORY);
  // Cambiadas a mano o con otro número de etapas: no se tocan.
  assert.equal(stagePlan(["Nuevo", ...FACTORY.slice(1)], "tienda", FACTORY), null);
  assert.equal(stagePlan(FACTORY.slice(0, 5), "tienda", FACTORY), null);
});

test("el conocimiento recoge lo que contó y cuenta cada dato", () => {
  assert.equal(knowledgeDoc(base(), "Acme"), null, "sin nada que contar no hay documento");

  const doc = knowledgeDoc(
    base({
      description: "Ropa deportiva para mujer",
      city: "Lima",
      answers: { envios: "A todo el país en 3 días", pagos: "  ", inventada: "no cuenta" },
      hours: { days: "ls", from: "09:00", to: "19:00" },
      extra: "No damos descuentos",
    }),
    "Acme",
  );
  assert.ok(doc);
  assert.equal(doc.title, "Información de Acme");
  assert.match(doc.content, /¿Hacen envíos\?.*\nA todo el país en 3 días/s);
  assert.match(doc.content, /de lunes a sábado de 09:00 a 19:00/);
  assert.doesNotMatch(doc.content, /no cuenta/, "solo las preguntas del rubro");
  // descripción, ciudad, horario, una respuesta y los datos extra
  assert.equal(doc.facts, 5);
});

test("respuestas rápidas: un saludo y una por respuesta del rubro", () => {
  const qr = quickRepliesFor(base({ answers: { envios: "A todo el país", cambios: "7 días" } }), "Acme");
  assert.deepEqual(
    qr.map((q) => q.shortcut),
    ["/hola", "/envios", "/cambios"],
  );
  assert.match(qr[0]!.body, /\{\{nombre\}\}/);
  assert.match(quickRepliesFor(base({ tone: "formal" }), "Acme")[0]!.body, /ayudarle/);
});

test("el horario cubre los días elegidos y avisa fuera de él", () => {
  const lv = businessHoursFor({ days: "lv", from: "09:00", to: "18:00" }, "America/Bogota", "Acme");
  assert.equal(lv.timezone, "America/Bogota");
  assert.deepEqual(lv.days.mon, { from: "09:00", to: "18:00" });
  assert.equal(lv.days.sat, null);
  assert.equal(lv.days.sun, null);
  assert.match(lv.outOfHoursMessage!, /de lunes a viernes de 09:00 a 18:00/);
  const all = businessHoursFor({ days: "all", from: "10:00", to: "22:00" }, "America/Lima", "Acme");
  assert.deepEqual(all.days.sun, { from: "10:00", to: "22:00" });
});

test("las instrucciones sin IA llevan sus datos y solo las herramientas activas", () => {
  const p = base({ description: "Ropa deportiva", answers: { envios: "A todo el país en 3 días" } });
  const prompt = localAgentPrompt(p, "Acme", ["search_knowledge", "handoff_to_human"]);
  assert.match(prompt, /^# ROL\nEres Sofía, asistente por WhatsApp de Acme/);
  assert.match(prompt, /Envíos: A todo el país en 3 días/);
  assert.match(prompt, /search_knowledge/);
  assert.doesNotMatch(prompt, /search_products/);
  assert.match(prompt, /asesor, humano, persona, reclamo/);
  assert.doesNotMatch(prompt, /\.\./, "sin dobles puntos");
});

test("el borrador va por pasos, con los botones solo en el cierre y los datos reales de la cuenta", () => {
  const p = base({ businessType: "educacion", goal: "vender" });
  const tools = ["search_products", "search_knowledge", "handoff_to_human", "mark_lead", "move_deal_stage", "reply_with_buttons"];
  const facts = { stages: ["Entrantes", "Contactado", "Interesado", "Matrícula en proceso", "Inscrito", "Perdido"], products: 3, productFields: ["Horario"], productFiles: [] };
  const prompt = localAgentPrompt(p, "Acme", tools, facts);
  assert.match(prompt, /# REGLAS CRÍTICAS[\s\S]*# FLUJO DE LA CONVERSACIÓN[\s\S]*## PASO 5/);
  assert.match(prompt, /BOTONES: solo usas botones cuando preguntas «¿Te gustaría separar tu cupo\?», y son exactamente «Sí, sepárame» y «Tengo dudas»/);
  assert.match(prompt, /responde EXACTAMENTE:\n\n\*«Nombre»\*\n«Descripción»\n💰 «Precio»\n• Horario: «Horario»\n\n¿Te gustaría separar tu cupo\?/);
  assert.match(prompt, /Usa mark_lead con «potential» y move_deal_stage a «Matrícula en proceso»\./);
  assert.match(prompt, /Luego usa handoff_to_human y mark_lead con «purchase»\./);
  assert.doesNotMatch(prompt, /send_payment_methods|send_product_file/, "sin las herramientas que no tiene");
  assert.match(prompt, /Tu objetivo: que el cliente separe su cupo y envíe su comprobante\./);
  assert.doesNotMatch(prompt, /\n\n\n/, "sin dobles líneas en blanco");
  assert.match(prompt, /1\. PLANTILLAS: cuando un paso dice «responde EXACTAMENTE»[^\n]*sin las comillas « »/);
  assert.match(prompt, /Responde su duda en 1 a 3 frases[^\n]*y, en ese mismo mensaje, termina con «¿Te gustaría separar tu cupo\?»/);
  assert.match(prompt, /- mark_lead: Solo en los pasos que lo indican/, "lo que se anota en el CRM lo dicen los pasos");
  assert.match(prompt, /# EJEMPLOS\nCliente: Hola, quiero información\nSofía: \[usa search_products y responde como dice el Paso 1\]/);
  assert.match(prompt, /\[botones: Sí, sepárame \/ Tengo dudas\]/);
  assert.match(prompt, /Ejemplo INCORRECTO \(no hagas esto\):\nSofía: .*botones fuera del único caso permitido\./);

  // Sin catálogo ni embudo de seis etapas: pauta en vez de plantilla, y sin nombrar una etapa.
  const bare = localAgentPrompt(p, "Acme", tools);
  assert.match(bare, /Preséntalo en pocas líneas/);
  assert.doesNotMatch(bare, /move_deal_stage a «/);

  // Quien agenda de usted no recibe emojis ni tuteo en las frases para el cliente.
  const formal = localAgentPrompt(base({ businessType: "salud", goal: "agendar", tone: "formal" }), "Acme", ["search_knowledge", "handoff_to_human"]);
  assert.match(formal, /Trata siempre de usted/);
  assert.doesNotMatch(formal, /BOTONES/);
  assert.match(formal, /termina con «¿Le agendo una cita\?»/, "la pregunta de cierre, también de usted");
  const booked = localAgentPrompt(base({ businessType: "salud", goal: "agendar", tone: "formal" }), "Acme", ["book_appointment", "mark_lead", "move_deal_stage", "reply_with_buttons"], {
    stages: ["Entrantes", "Contactado", "Interesado", "Cita agendada", "Atendido", "Perdido"], products: 0, productFields: [], productFiles: [],
  });
  assert.match(booked, /«Sí, agéndeme» y «Tengo dudas»/);
  assert.match(booked, /Usa mark_lead con «purchase» y move_deal_stage a «Cita agendada» cuando la cita quede confirmada\./);
  assert.match(formal, /## PASO 4 — Elige día y hora\nDile que una persona del equipo le confirmará la cita y usa handoff_to_human\./);
});

test("el encargo cuenta cómo avanza una venta en su rubro y que el saludo ya sale solo", () => {
  const brief = composeBrief(base({ businessType: "educacion", goal: "vender", welcome: true }), "Acme", { draft: true });
  assert.match(brief, /separa su cupo → paga y envía el comprobante/);
  assert.match(brief, /Pregunta de cierre: «¿Te gustaría separar tu cupo\?»[\s\S]*«Sí, sepárame» y «Tengo dudas»/);
  assert.match(brief, /El agente NO lo envía ni lo repite/);
  assert.match(brief, /El texto actual es un borrador[\s\S]*sin hacer preguntas/);
  // Quien da soporte no cierra una venta: sin pregunta de cierre.
  assert.doesNotMatch(composeBrief(base({ goal: "soporte" }), "Acme"), /Pregunta de cierre/);
});

test("el encargo al redactor lleva el horario y pide no preguntar", () => {
  const brief = composeBrief(base({ hours: { days: "lv", from: "09:00", to: "18:00" } }), "Acme");
  assert.match(brief, /Horario de atención: de lunes a viernes de 09:00 a 18:00/);
  assert.match(brief, /sin hacer preguntas/);
  assert.match(composeBrief(base(), "Acme"), /Responde a cualquier hora/);
});

test("el esquema valida la web y el horario", () => {
  assert.ok(businessSetupSchema.safeParse({ ...base(), website: "tutienda.com.pe/catalogo" }).success);
  assert.ok(businessSetupSchema.safeParse({ ...base(), website: "https://www.tutienda.com" }).success);
  assert.ok(!businessSetupSchema.safeParse({ ...base(), website: "no es una web" }).success);
  assert.ok(!businessSetupSchema.safeParse({ ...base(), hours: { days: "lv", from: "18:00", to: "09:00" } }).success);
  assert.equal(normalizeWebsite("tutienda.com"), "https://tutienda.com");
  assert.equal(normalizeWebsite("http://tutienda.com"), "http://tutienda.com");
});

test("el saludo cambia con el tono y nunca queda sin nombre", () => {
  assert.match(welcomeMessageFor("cercano", "Sofía", "Acme"), /Soy Sofía.*Acme|Acme.*Soy Sofía/);
  assert.match(welcomeMessageFor("formal", "Sofía", "Acme"), /Le saluda Sofía/);
  assert.match(welcomeMessageFor("juvenil", "", ""), /tu asistente/);
});
