import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface FeedbackProps {
  fromEmail?: string;
  message?: string;
  source?: string;
}

function FeedbackEmail({ fromEmail = "anonymous", message = "(no message)", source = "linkedincontentgenerator.com" }: FeedbackProps) {
  return (
    <Html>
      <Head />
      <Preview>New feedback from {fromEmail}</Preview>
      <Body style={{ background: "#ffffff", fontFamily: "Arial, sans-serif" }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
          <Heading style={{ fontSize: 20, color: "#0a0a0a" }}>New feedback received</Heading>
          <Text style={{ color: "#475569" }}>From: <strong>{fromEmail}</strong></Text>
          <Text style={{ color: "#475569" }}>Source: {source}</Text>
          <Hr />
          <Section>
            <Text style={{ whiteSpace: "pre-wrap", color: "#0a0a0a", fontSize: 15, lineHeight: "22px" }}>
              {message}
            </Text>
          </Section>
          <Hr />
          <Text style={{ fontSize: 12, color: "#94a3b8" }}>
            Sent automatically from the LinkedIn Content Planner feedback form.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const template = {
  component: FeedbackEmail,
  displayName: "Feedback Notification",
  subject: (data: Record<string, any>) => `New feedback from ${data?.fromEmail ?? "visitor"}`,
  to: "smei@boconcept.de",
  previewData: {
    fromEmail: "user@example.com",
    message: "Great tool! Could you add support for scheduling threads?",
    source: "linkedincontentgenerator.com",
  },
} satisfies TemplateEntry;
