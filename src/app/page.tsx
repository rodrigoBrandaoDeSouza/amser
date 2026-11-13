import Link from "next/link";

const PILLARS = [
  {
    title: "Sua cara, pronta em 10 minutos",
    text: "Mande o logo e algumas fotos. A IA monta uma página de agendamento com as cores e o estilo da sua marca — você revisa e publica.",
  },
  {
    title: "Se paga cortando as faltas",
    text: "Sinal via Pix na hora de agendar, confirmação de presença pelo WhatsApp e horário liberado quando o cliente some.",
  },
  {
    title: "Sem comissão. O cliente é seu.",
    text: "Nada de marketplace mostrando concorrentes. WhatsApp incluído no plano e sua base de clientes exportável quando quiser.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-16">
      <nav className="mb-16 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight">Amser</span>
        <Link href="/login" className="text-sm font-medium text-zinc-700 hover:underline">
          Entrar
        </Link>
      </nav>
      <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
        Sua página de agendamento com a cara da sua marca.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-zinc-600">
        Pronta em 10 minutos e que se paga cortando as faltas. Sem comissão, sem taxa escondida de WhatsApp.
      </p>
      <Link href="/cadastro" className="mt-6 inline-flex rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-700">
        Criar minha página grátis
      </Link>
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {PILLARS.map((p) => (
          <div key={p.title} className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">{p.title}</h2>
            <p className="mt-2 text-sm text-zinc-600">{p.text}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
