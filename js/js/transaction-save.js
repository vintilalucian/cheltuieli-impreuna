// One form session owns one request ID. Retries only flush that request.
export function createTransactionSaveSession(store, { expenseId = null } = {}) {
  const requestId = expenseId || `entry_${crypto.randomUUID()}`;
  let submitted = false;
  let inFlight = null;
  const opId = (op) => op?.transfer?.id || op?.expense?.id || op?.id;
  const rejected = () => (store.state.failedQueue || []).find((item) => opId(item.op) === requestId);
  const result = () => {
    const failed = rejected();
    if (failed) return { status: "rejected", id: requestId, message: failed.error || "Cererea a fost respinsă." };
    const record = store.state.expenses.find((item) => item.id === requestId);
    const queued = (store.state.pendingQueue || []).some((op) => opId(op) === requestId);
    if (queued || record?.pendingSync) return { status: "pending", id: requestId, message: store.state.lastError || "Așteaptă confirmarea din Google Sheets." };
    if (!record) return { status: "unconfirmed", id: requestId, message: "Nu am confirmarea salvării. Datele formularului au fost păstrate." };
    return { status: store.isConnected() ? "confirmed" : "local", id: requestId };
  };
  return {
    get submitted() { return submitted; },
    save(payload) {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        if (submitted) {
          if (!rejected()) await store.flushQueue();
        } else {
          const before = store.state.expenses.find((item) => item.id === requestId);
          try {
            if (expenseId) await store.updateExpense(expenseId, payload);
            else if (payload.type === "transfer") await store.addTransfer({ ...payload, id: requestId });
            else await store.addExpense({ ...payload, id: requestId });
            submitted = true;
          } catch (error) {
            // An unexpected local persistence error must not create a second ID.
            submitted = store.state.expenses.find((item) => item.id === requestId) !== before ||
              (store.state.pendingQueue || []).some((op) => opId(op) === requestId) || Boolean(rejected());
            throw error;
          }
        }
        return result();
      })().finally(() => { inFlight = null; });
      return inFlight;
    }
  };
}
