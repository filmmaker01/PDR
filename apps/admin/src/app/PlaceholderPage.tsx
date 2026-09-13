import { Alert, Stack, Title } from '@mantine/core';

export function PlaceholderPage({ title, stage }: { title: string; stage?: string }) {
  return (
    <Stack>
      <Title order={2}>{title}</Title>
      <Alert color="gray">Раздел в разработке{stage ? `, появится на этапе: ${stage}` : ''}.</Alert>
    </Stack>
  );
}
