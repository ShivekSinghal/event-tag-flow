import { useState, useCallback } from "react";
import { FlyingCard } from "@/components/ui/flying-card";

interface FlyingCardData {
  id: string;
  amount: number;
  name: string;
  studio: string;
  type: "topup" | "sale";
}

export function useFlyingCards() {
  const [cards, setCards] = useState<FlyingCardData[]>([]);

  const addCard = useCallback((cardData: Omit<FlyingCardData, "id">) => {
    const id = Date.now().toString();
    setCards(prev => [...prev, { ...cardData, id }]);
  }, []);

  const removeCard = useCallback((id: string) => {
    setCards(prev => prev.filter(card => card.id !== id));
  }, []);

  const FlyingCards = useCallback(() => (
    <>
      {cards.map(card => (
        <FlyingCard
          key={card.id}
          amount={card.amount}
          name={card.name}
          studio={card.studio}
          type={card.type}
          onComplete={() => removeCard(card.id)}
        />
      ))}
    </>
  ), [cards, removeCard]);

  return {
    addCard,
    FlyingCards
  };
}