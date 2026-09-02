import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatCoins } from "@/lib/coins";

interface FlyingCardProps {
  amount: number;
  name: string;
  studio: string;
  type: "topup" | "sale";
  onComplete?: (dotPosition: { x: number; y: number }) => void;
}

export function FlyingCard({ amount, name, studio, type, onComplete }: FlyingCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position] = useState(() => ({
    x: Math.random() * (window.innerWidth - 200) + 100, // Random X position
    startY: window.innerHeight + 100, // Start below viewport
    endY: -100 // End above viewport
  }));

  useEffect(() => {
    // Start animation immediately
    setIsVisible(true);

    // Complete animation and place dot
    const timer = setTimeout(() => {
      setIsVisible(false);
      // Generate random dot position near center logo area
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const dotPosition = {
        x: centerX + (Math.random() - 0.5) * 400, // ±200px from center
        y: centerY + (Math.random() - 0.5) * 200  // ±100px from center
      };
      setTimeout(() => {
        onComplete?.(dotPosition);
      }, 300);
    }, 6000);

    return () => {
      clearTimeout(timer);
    };
  }, [onComplete]);

  if (!isVisible) return null;

  return (
    <div 
      className="fixed pointer-events-none z-50"
      style={{ 
        left: position.x,
        transform: 'translateX(-50%)'
      }}
    >
      <div 
        className={cn(
          "bg-primary/90 backdrop-blur-sm rounded-lg p-3 text-primary-foreground shadow-lg",
          "animate-scroll-up-donation min-w-[200px] text-center"
        )}
      >
        <div className="font-bold text-lg">{formatCoins(amount)}</div>
        <div className="text-sm opacity-90">{name}</div>
        <div className="text-xs opacity-75">{studio}</div>
      </div>
    </div>
  );
}
