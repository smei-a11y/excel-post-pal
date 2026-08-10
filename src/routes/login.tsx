import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Zugang deaktiviert – LinkedIn Content Planner" },
      {
        name: "description",
        content:
          "Der LinkedIn Content Planner ist derzeit deaktiviert. Eine Anmeldung ist nicht möglich.",
      },
      { property: "og:title", content: "Zugang deaktiviert – LinkedIn Content Planner" },
      {
        property: "og:description",
        content: "Der LinkedIn Content Planner ist derzeit deaktiviert.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginDisabledPage,
});

function LoginDisabledPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-8 space-y-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Zugang deaktiviert</h1>
        <p className="text-sm text-muted-foreground">
          Der LinkedIn Content Planner ist derzeit außer Betrieb. Eine Anmeldung ist
          nicht möglich.
        </p>
      </Card>
    </div>
  );
}
