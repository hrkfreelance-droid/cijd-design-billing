"use client";

import { useState } from "react";

import { api, useI18n } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button, Input, Select } from "@/components/ui";
import type { Client } from "@/lib/types";
import { Modal, ModalSection } from "./modal";

/** Start a project. Its items are added in the project modal, like any other. */
export function NewProjectModal({
  clients,
  defaultClientId,
  onClose,
}: {
  clients: Client[];
  defaultClientId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { run, runResult, busy } = useAction();
  const [clientList, setClientList] = useState(clients);
  const [clientId, setClientId] = useState(defaultClientId ?? clients[0]?.id ?? "");
  const [name, setName] = useState("");
  const [addingClient, setAddingClient] = useState(false);
  const [clientName, setClientName] = useState("");

  const create = async () => {
    const ok = await run(
      () => api("/api/projects", { method: "POST", body: { clientId, name: name.trim() } }),
      { key: "v2.created" },
    );
    if (ok) onClose();
  };

  const createClient = async () => {
    const created = await runResult(() => api<Client>("/api/clients", {
      method: "POST",
      body: { name: clientName.trim() },
    }), { key: "v2.created" });
    if (created) {
      setClientList((current) => [...current, created]);
      setClientId(created.id);
      setClientName("");
      setAddingClient(false);
    }
  };

  return (
    <>
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={t("v2.newProject")}
      subtitle={t("v2.newProject.hint")}
      closeLabel={t("common.close")}
      footer={
        <Button
          variant="primary"
          full
          onClick={create}
          disabled={busy || !clientId || !name.trim()}
          className="min-h-[46px]"
          data-testid="v2-create-project"
        >
          {t("common.save")}
        </Button>
      }
    >
      <ModalSection title={t("v2.project")}>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-muted">
              {t("v2.client")}
            </span>
            <div className="flex gap-2">
              <Select
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                data-testid="v2-new-project-client"
              >
                {clientList.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="secondary" size="sm" onClick={() => setAddingClient(true)}>
                {t("v2.addClient")}
              </Button>
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-muted">
              {t("v2.projectName")}
            </span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) void create();
              }}
              data-testid="v2-new-project-name"
            />
          </label>
        </div>
      </ModalSection>
    </Modal>

    {addingClient && (
      <Modal
        open
        onClose={() => setAddingClient(false)}
        busy={busy}
        title={t("v2.newClient")}
        closeLabel={t("common.close")}
        footer={
          <Button variant="primary" full onClick={() => void createClient()} disabled={busy || !clientName.trim()}>
            {t("common.save")}
          </Button>
        }
      >
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-muted">{t("v2.clientName")}</span>
          <Input autoFocus value={clientName} onChange={(event) => setClientName(event.target.value)} />
        </label>
      </Modal>
    )}
    </>
  );
}
