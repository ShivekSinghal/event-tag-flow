import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  NfcIcon as Nfc, 
  Scan, 
  CheckCircle, 
  AlertCircle,
  User,
  Phone,
  Tag
} from "lucide-react";

export default function IssueTag() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [scannedTag, setScannedTag] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState("");
  const [attendeePhone, setAttendeePhone] = useState("");

  const handleScanNFC = async () => {
    setIsScanning(true);
    
    try {
      // Simulate NFC scan - in real app, this would use WebNFC API
      await new Promise(resolve => setTimeout(resolve, 2000));
      const mockTagId = `NFC${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      setScannedTag(mockTagId);
      
      toast({
        title: "NFC Tag Scanned",
        description: `Successfully scanned tag: ${mockTagId}`,
      });
    } catch (error) {
      toast({
        title: "Scanning Failed",
        description: "Could not scan NFC tag. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleIssueWallet = async () => {
    if (!scannedTag || !attendeeName || !attendeePhone) {
      toast({
        title: "Missing Information",
        description: "Please scan a tag and fill in all attendee details.",
        variant: "destructive",
      });
      return;
    }

    try {
      // In real app, this would create wallet in Supabase
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      toast({
        title: "Wallet Created Successfully",
        description: `Digital wallet created for ${attendeeName} with tag ${scannedTag}`,
      });

      // Reset form
      setScannedTag(null);
      setAttendeeName("");
      setAttendeePhone("");
    } catch (error) {
      toast({
        title: "Failed to Create Wallet",
        description: "There was an error creating the wallet. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Issue NFC Tag</h1>
        <p className="text-muted-foreground mt-2">Scan an NFC tag and create a new digital wallet</p>
      </div>

      {/* NFC Scanning Card */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Nfc className="w-5 h-5 text-primary" />
            <span>NFC Tag Scanner</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Scan Button */}
          <div className="text-center">
            <Button
              onClick={handleScanNFC}
              disabled={isScanning}
              size="lg"
              className="w-full max-w-xs bg-gradient-primary hover:shadow-hover transition-smooth"
            >
              {isScanning ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  <span>Scanning...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Scan className="w-5 h-5" />
                  <span>Scan NFC Tag</span>
                </div>
              )}
            </Button>
          </div>

          {/* Scanned Tag Display */}
          {scannedTag && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-4 flex items-center space-x-3">
              <CheckCircle className="w-6 h-6 text-success" />
              <div>
                <div className="font-medium text-foreground">Tag Scanned Successfully</div>
                <div className="text-sm text-muted-foreground">
                  Tag ID: <Badge variant="outline" className="ml-1">{scannedTag}</Badge>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attendee Information Card */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <User className="w-5 h-5 text-primary" />
            <span>Attendee Information</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="flex items-center space-x-2">
              <User className="w-4 h-4" />
              <span>Full Name</span>
            </Label>
            <Input
              id="name"
              placeholder="Enter attendee's full name"
              value={attendeeName}
              onChange={(e) => setAttendeeName(e.target.value)}
              className="transition-smooth focus:shadow-hover"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="flex items-center space-x-2">
              <Phone className="w-4 h-4" />
              <span>Phone Number</span>
            </Label>
            <Input
              id="phone"
              placeholder="Enter phone number"
              value={attendeePhone}
              onChange={(e) => setAttendeePhone(e.target.value)}
              className="transition-smooth focus:shadow-hover"
            />
          </div>
        </CardContent>
      </Card>

      {/* Issue Wallet Button */}
      <div className="text-center">
        <Button
          onClick={handleIssueWallet}
          disabled={!scannedTag || !attendeeName || !attendeePhone}
          size="lg"
          className="w-full max-w-xs bg-gradient-primary hover:shadow-hover transition-smooth"
        >
          <div className="flex items-center space-x-2">
            <Tag className="w-5 h-5" />
            <span>Create Digital Wallet</span>
          </div>
        </Button>
      </div>

      {/* Info Card */}
      <Card className="shadow-card bg-muted/50">
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-primary mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-2">NFC Tag Requirements:</p>
              <ul className="space-y-1">
                <li>• Use NTAG213/215/216 compatible tags</li>
                <li>• Each tag can only be linked to one wallet</li>
                <li>• Keep the attendee's phone number for balance inquiries</li>
                <li>• Tags cannot be transferred between attendees</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}