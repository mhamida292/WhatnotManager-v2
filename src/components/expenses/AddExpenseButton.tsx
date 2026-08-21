"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ExpenseForm } from "@/components/ExpenseForm";

export function AddExpenseButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>＋ Add expense</Button>
      {open && (
        <Modal title="Add expense" onClose={() => setOpen(false)}>
          <ExpenseForm />
        </Modal>
      )}
    </>
  );
}
