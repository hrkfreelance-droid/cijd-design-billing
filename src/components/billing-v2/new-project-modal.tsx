"use client";

import { useState } from "react";

import { api, useData, useI18n, useToast } from "@/components/providers";
import { useAction } from "@/components/use-action";
import { Button, Input, Select } from "@/components/ui";
import type { Client, Project } from "@/lib/types";
import { Modal } from "./modal";

const NEW_CLIENT = "__new__";

/**
 * Start a project: a client and a name, nothing else. Services and prices are
 * added from the project itself, whenever they are known. A client that is
 * not in the list yet is typed in right here, in the same Save.
 */
export function NewProjectModal({
  clients,
  onClose,
  onCreated,
}: {
  clients: Client[];
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const { t } = useI18n();
  const { refresh } = useData();
  const { toast } = useToast();
  const { describe } = useAction();
  const [clientId, setClientId] = useState(clients[0]?.id ?? NEW_CLIENT);
  const [clientName, setClientName] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addingClient = clientId === NEW_CLIENT;
  const canSave = !saving && name.trim() !== "" && (!addingClient || clientName.trim() !== "");

  const create = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      let targetId = clientId;
      if (addingClient) {
        const client = await api<Client>("/api/clients", { method: "POST", body: { name: clientName.trim() } });
        targetId = client.id;
        // Keep the new client selected, so a retry does not add it twice.
        setClientId(client.id);
      }
      const project = await api<Project>("/api/projects", {
        method: "POST",
        body: { clientId: targetId, name: name.trim() },
      });
      await refresh();
      toast(t("v2.created"));
      onCreated(project.id);
      onClose();
    } catch (failure) {
      console.error("[billing-v2] create project failed", failure);
      setError(describe(failure));
      setSaving(false);
      // A client may have been added before the failure; show it in the list.
      await refresh();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      size="sm"
      title={t("v2.newProject")}
      subtitle={t("v2.newProject.hint")}
      closeLabel={t("common.close")}
      testId="v2-new-project-modal"
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" full onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" full onClick={() => void create()} disabled={!canSave} data-testid="v2-create-project">
              {saving ? t("v2.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      }
    >
      <form
        className="space-y-4 pb-1"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("v2.client")}</span>
          <Select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            disabled={saving}
            data-testid="v2-new-project-client"
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
            <option value={NEW_CLIENT}>{t("v2.addClient")}</option>
          </Select>
        </label>
        {addingClient && (
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">{t("v2.clientName")}</span>
            <Input
              autoFocus
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              disabled={saving}
              enterKeyHint="next"
              data-testid="v2-new-client-name"
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">{t("v2.projectName")}</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={saving}
            enterKeyHint="done"
            data-testid="v2-new-project-name"
          />
        </label>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
