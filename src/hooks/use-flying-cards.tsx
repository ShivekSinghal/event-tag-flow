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
  amount: number;
}

export function useFlyingCards() {
  const [cards, setCards] = useState<FlyingCardData[]>([]);
  const [dots, setDots] = useState<DotPosition[]>([]);

  const addCard = useCallback((cardData: Omit<FlyingCardData, "id">) => {
    const id = Date.now().toString();
    setCards(prev => [...prev, { ...cardData, id }]);
  }, []);

  const removeCard = useCallback((id: string, dotPosition?: { x: number; y: number }, amount?: number) => {
    setCards(prev => prev.filter(card => card.id !== id));
    
    // Add a dot at the specified position with amount for sizing
    if (dotPosition && amount) {
      setDots(prev => [...prev, { ...dotPosition, id: `dot-${Date.now()}`, amount }]);
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
          onComplete={(dotPosition) => removeCard(card.id, dotPosition, card.amount)}
        />
      ))}
    </>
  ), [cards, removeCard]);

  const DonationDots = useCallback(() => (
    <>
      {dots.map(dot => {
        // Calculate dot size based on amount - minimum 6px, max 20px
        const size = Math.min(20, Math.max(6, (dot.amount / 100) * 4));
        return (
          <div
            key={dot.id}
            className="fixed rounded-full donation-dot pointer-events-none z-30"
            style={{
              left: dot.x,
              top: dot.y,
              width: `${size}px`,
              height: `${size}px`,
              backgroundColor: '#ff007f'
            }}
          />
        );
      })}
    </>
  ), [dots]);

  return {
    addCard,
    FlyingCards,
    DonationDots,
    dotsCount: dots.length
  };
}