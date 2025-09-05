import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wallet, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

interface FlyingCardProps {
  amount: number;
  name: string;
  studio: string;
  type: "topup" | "sale";
  onComplete?: () => void;
}

export function FlyingCard({ amount, name, studio, type, onComplete }: FlyingCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // Start animation after component mounts
    const timer1 = setTimeout(() => {
      setIsVisible(true);
      setIsAnimating(true);
    }, 100);

    // Hide and trigger completion after animation
    const timer2 = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => {
        onComplete?.();
      }, 300);
    }, 3000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [onComplete]);

  if (!isVisible) return null;

  const Icon = type === "topup" ? Wallet : ShoppingCart;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
      <Card 
        className={cn(
          "p-4 bg-card/95 backdrop-blur-sm border shadow-lg min-w-[300px]",
          "transition-all duration-1000 ease-out",
          isAnimating 
            ? "transform scale-100 opacity-100 translate-y-0" 
            : "transform scale-75 opacity-0 translate-y-4"
        )}
      >
        <div className="flex items-center space-x-4">
          <div className={cn(
            "p-3 rounded-full",
            type === "topup" 
              ? "bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400" 
              : "bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
          )}>
            <Icon className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-foreground">{name}</span>
              <Badge variant="outline" className="text-xs">
                {studio}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {type === "topup" ? "Wallet Top-up" : "Game Purchase"}
              </span>
              <span className="font-bold text-lg text-primary">
                ₹{amount.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}