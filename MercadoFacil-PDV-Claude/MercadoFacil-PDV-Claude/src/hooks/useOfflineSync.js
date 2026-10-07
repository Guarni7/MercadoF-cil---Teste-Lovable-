// Offline mode hook — queues sales in localStorage when offline, syncs when back online.
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/dataClient";

const QUEUE_KEY = "offline_sale_queue";

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);

  // Load queue from storage
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      setQueue(stored);
    } catch {
      setQueue([]);
    }
  }, []);

  // Listen to online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const persistQueue = (newQueue) => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(newQueue));
    setQueue(newQueue);
  };

  // Queue a sale for later sync
  const queueSale = useCallback((saleData) => {
    const item = {
      id: `offline_${Date.now()}`,
      ...saleData,
      queuedAt: new Date().toISOString(),
    };
    const newQueue = [...queue, item];
    persistQueue(newQueue);
    return item;
  }, [queue]);

  // Sync queued sales to the server
  const syncQueue = useCallback(async () => {
    if (syncing) return;
    const stored = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    if (stored.length === 0) return;

    setSyncing(true);
    const synced = [];
    const remaining = [];

    for (const item of stored) {
      try {
        // Create the sale
        const sale = await api.entities.Sale.create(item.saleData);
        // Update product stock
        if (item.stockUpdates) {
          for (const update of item.stockUpdates) {
            try {
              const product = await api.entities.Product.get(update.productId);
              await api.entities.Product.update(update.productId, {
                stock: (product.stock || 0) - update.quantity,
              });
            } catch {}
          }
        }
        synced.push(item.id);
      } catch (e) {
        // Keep in queue if it failed
        remaining.push(item);
      }
    }

    persistQueue(remaining);
    setSyncing(false);
    return { synced: synced.length, remaining: remaining.length };
  }, [syncing]);

  // Remove a queued sale (if cancelled)
  const removeFromQueue = useCallback((id) => {
    const newQueue = queue.filter((q) => q.id !== id);
    persistQueue(newQueue);
  }, [queue]);

  return {
    isOnline,
    queue,
    syncing,
    queueSale,
    syncQueue,
    removeFromQueue,
    queueCount: queue.length,
  };
}