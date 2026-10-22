import { Tabs } from "@/components/ui/primitives";

export function AttendanceNav({ active }: { active: "ocorrencias" | "consolidado" | "jornadas" | "escala" }) {
  return (
    <Tabs
      active={active}
      items={[
        { key: "ocorrencias", label: "Ocorrências", href: "/frequencia" },
        { key: "consolidado", label: "Consolidado de horas", href: "/frequencia/consolidado" },
        { key: "escala", label: "Escala / calendário", href: "/frequencia/escala" },
        { key: "jornadas", label: "Jornadas e vigências", href: "/frequencia/jornadas" },
      ]}
    />
  );
}
