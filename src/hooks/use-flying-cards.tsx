import { useState, useCallback } from "react";
import { FlyingCard } from "@/components/ui/flying-card";

interface FlyingCardData {
  id: string;
  amount: number;
  name: string;
  studio: string;
  type: "topup" | "sale";
}

interface DotPosition {
  x: number;
  y: number;
  id: string;
}

export function useFlyingCards() {
  const [cards, setCards] = useState<FlyingCardData[]>([]);
  const [dots, setDots] = useState<DotPosition[]>([]);

  const addCard = useCallback((cardData: Omit<FlyingCardData, "id">) => {
    const id = Date.now().toString();
    setCards(prev => [...prev, { ...cardData, id }]);
  }, []);

  const removeCard = useCallback((id: string, dotPosition?: { x: number; y: number }) => {
    setCards(prev => prev.filter(card => card.id !== id));
    
    // Add a dot at the specified position
    if (dotPosition) {
      setDots(prev => [...prev, { ...dotPosition, id: `dot-${Date.now()}` }]);
    }
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
          onComplete={(dotPosition) => removeCard(card.id, dotPosition)}
        />
      ))}
    </>
  ), [cards, removeCard]);

  const DonationDots = useCallback(() => (
    <>
      {dots.map(dot => (
        <div
          key={dot.id}
          className="fixed w-2 h-2 rounded-full donation-dot pointer-events-none z-30"
          style={{
            left: dot.x,
            top: dot.y,
            backgroundColor: '#ff007f'
          }}
        />
      ))}
    </>
  ), [dots]);

  return {
    addCard,
    FlyingCards,
    DonationDots,
    dotsCount: dots.length
  };
}