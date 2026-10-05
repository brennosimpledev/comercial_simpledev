"use client";

import { useState } from "react";

// Area de upload que aceita clique e arrastar-e-soltar. Usada em todos os
// pontos de envio do sistema para o comportamento ser sempre o mesmo.
export function DropZone({
  onFiles,
  label,
  enviando = false,
  labelEnviando = "Enviando...",
  multiple = false,
  accept,
  className = "px-3 py-3",
}: {
  onFiles: (files: File[]) => void | Promise<void>;
  label: string;
  enviando?: boolean;
  labelEnviando?: string;
  multiple?: boolean;
  accept?: string;
  className?: string;
}) {
  const [sobre, setSobre] = useState(false);

  function receber(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const arquivos = Array.from(lista);
    onFiles(multiple ? arquivos : arquivos.slice(0, 1));
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        if (!enviando) setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSobre(false);
        if (enviando) return;
        receber(e.dataTransfer.files);
      }}
      className={
        "flex cursor-pointer items-center justify-center rounded-lg border border-dashed text-center text-sm transition " +
        className +
        " " +
        (sobre
          ? "border-brand bg-brand/10 text-brand"
          : "border-white/10 text-slate-400 hover:border-brand/40 hover:text-slate-200")
      }
    >
      {enviando ? labelEnviando : sobre ? "Solte aqui" : label}
      <input
        type="file"
        className="hidden"
        multiple={multiple}
        accept={accept}
        disabled={enviando}
        onChange={(e) => {
          receber(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}
