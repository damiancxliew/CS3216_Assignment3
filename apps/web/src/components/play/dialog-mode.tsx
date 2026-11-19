"use client";
import { createContext, useContext } from "react";

/**
 * Game dialogs are modal by default. The teacher preview turns this off so its edit panel
 * stays usable while a document or card is open; the dialogs then sit above the game only.
 */
const ModalDialogs = createContext(true);
export const ModalDialogsProvider = ModalDialogs.Provider;
export const useModalDialogs = () => useContext(ModalDialogs);

export function openPlayDialog(dialog: HTMLDialogElement, modal: boolean) {
  if (modal) dialog.showModal();
  else dialog.show();
}
