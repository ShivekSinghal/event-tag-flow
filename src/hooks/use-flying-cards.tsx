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
  name: string;
  studio: string;
}

export function useFlyingCards() {
  const [cards, setCards] = useState<FlyingCardData[]>([]);
  const [dots, setDots] = useState<DotPosition[]>([]);

  const addCard = useCallback((cardData: Omit<FlyingCardData, "id">) => {
    const id = Date.now().toString();
    setCards(prev => [...prev, { ...cardData, id }]);
  }, []);

  const removeCard = useCallback((id: string, dotPosition?: { x: number; y: number }, amount?: number, name?: string, studio?: string) => {
    setCards(prev => prev.filter(card => card.id !== id));
    
    // Add a dot at the specified position with amount for sizing and name/studio info
    if (dotPosition && amount && name && studio) {
      setDots(prev => [...prev, { 
        ...dotPosition, 
        id: `dot-${Date.now()}`, 
        amount,
        name,
        studio
      }]);
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
          onComplete={(dotPosition) => removeCard(card.id, dotPosition, card.amount, card.name, card.studio)}
        />
      ))}
    </>
  ), [cards, removeCard]);

  const DonationDots = useCallback(() => (
    <>
      {dots.map(dot => {
        // Calculate dot size based on percentage of amount (0-10,000) - minimum 4px, max 30px
        const percentage = (dot.amount / 10000) * 100;
        const size = Math.min(30, Math.max(4, (percentage / 100) * 26 + 4));
        return (
          <div
            key={dot.id}
            className="fixed pointer-events-none z-30"
            style={{
              left: dot.x - size/2, // Center the dot horizontally
              top: dot.y - size/2,  // Center the dot vertically
            }}
          >
            {/* The circle */}
            <div
              className="rounded-full donation-dot mb-1"
              style={{
                width: `${size}px`,
                height: `${size}px`,
                backgroundColor: '#ff007f',
                margin: '0 auto'
              }}
            />
            
            {/* Name and Studio underneath */}
            <div className="text-center text-xs text-white bg-black/60 rounded px-2 py-1 backdrop-blur-sm whitespace-nowrap">
              <div className="font-semibold">{dot.name}</div>
              <div className="text-xs opacity-80">{dot.studio}</div>
            </div>
          </div>
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