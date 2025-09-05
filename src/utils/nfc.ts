/**
 * NFC Utility functions for cross-platform NFC scanning
 * Uses @exxili/capacitor-nfc for iOS/Android and WebNFC API as fallback
 */

import { Capacitor } from '@capacitor/core';

export interface NFCReadResult {
  tagId: string;
  success: boolean;
  error?: string;
}

export class NFCManager {
  private static instance: NFCManager;
  private reader: any = null;
  private nfcPlugin: any = null;

  static getInstance(): NFCManager {
    if (!NFCManager.instance) {
      NFCManager.instance = new NFCManager();
    }
    return NFCManager.instance;
  }

  constructor() {
    // Import NFC plugin dynamically for mobile platforms
    if (Capacitor.isNativePlatform()) {
      import('@exxili/capacitor-nfc').then((module) => {
        this.nfcPlugin = module.NFC;
      }).catch(() => {
        console.warn('NFC plugin not available');
      });
    }
  }

  /**
   * Check if NFC is supported on this device
   */
  isNFCSupported(): boolean {
    // For native platforms (iOS/Android), check if NFC plugin is available
    if (Capacitor.isNativePlatform()) {
      return this.nfcPlugin !== null;
    }
    // For web, check WebNFC API
    return 'NDEFReader' in window;
  }

  /**
   * Check if NFC permission is granted
   */
  async checkNFCPermission(): Promise<boolean> {
    if (!this.isNFCSupported()) return false;
    
    try {
      const permission = await navigator.permissions.query({ name: 'nfc' as any });
      return permission.state === 'granted';
    } catch (error) {
      console.warn('NFC permission check failed:', error);
      return false;
    }
  }

  /**
   * Start scanning for NFC tags
   */
  async startScanning(): Promise<NFCReadResult> {
    // Use native NFC plugin for iOS/Android
    if (Capacitor.isNativePlatform() && this.nfcPlugin) {
      return this.scanWithNativePlugin();
    }

    // Use WebNFC API for web browsers
    return this.scanWithWebNFC();
  }

  /**
   * Scan using @exxili/capacitor-nfc plugin (iOS/Android)
   */
  private async scanWithNativePlugin(): Promise<NFCReadResult> {
    try {
      // Start scanning for NDEF messages
      const result = await this.nfcPlugin.readTag();
      console.log('Native NFC scan result:', result);

      if (result && result.message && result.message.records && result.message.records.length > 0) {
        // Extract tag identifier from the first record or use a generated ID
        const record = result.message.records[0];
        let tagId = '';
        
        if (record.id) {
          tagId = this.formatTagId(record.id);
        } else if (record.payload) {
          // Generate ID from payload
          const decoder = new TextDecoder();
          const text = decoder.decode(new Uint8Array(record.payload));
          tagId = this.formatTagId(text.substring(0, 6));
        } else {
          // Generate a timestamp-based ID
          tagId = this.formatTagId(Date.now().toString().slice(-6));
        }
        
        console.log('Generated tag ID:', tagId);

        return {
          tagId,
          success: true
        };
      } else {
        return {
          tagId: '',
          success: false,
          error: 'No NFC tag detected. Please try again.'
        };
      }

    } catch (error: any) {
      const errorMessage = error?.message || 'NFC scan failed';
      console.log('Native NFC scan error:', error);
      return {
        tagId: '',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Scan using WebNFC API (Chrome on Android)
   */
  private async scanWithWebNFC(): Promise<NFCReadResult> {
    try {
      // Create new NDEFReader instance
      this.reader = new (window as any).NDEFReader();
      
      // Start scanning
      await this.reader.scan();
      
      return new Promise((resolve) => {
        // Set up event listeners
        this.reader.addEventListener('reading', (event: any) => {
          const tagId = this.extractTagId(event);
          resolve({
            tagId,
            success: true
          });
        });

        this.reader.addEventListener('readingerror', (error: any) => {
          const errorMessage = error?.message || 'NFC reading failed';
          console.log('WebNFC reading error:', error);
          resolve({
            tagId: '',
            success: false,
            error: errorMessage
          });
        });

        // Timeout after 30 seconds
        setTimeout(() => {
          resolve({
            tagId: '',
            success: false,
            error: 'NFC scan timeout. Please try again.'
          });
        }, 30000);
      });
      
    } catch (error: any) {
      const errorMessage = error?.message || 'NFC scan failed';
      console.log('WebNFC scan error:', error);
      return {
        tagId: '',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Stop NFC scanning
   */
  stopScanning(): void {
    // Stop native NFC scanning - this plugin doesn't require explicit stop
    if (Capacitor.isNativePlatform() && this.nfcPlugin) {
      // The @exxili/capacitor-nfc plugin doesn't require explicit stop
      console.log('NFC scan completed');
    }

    // Stop WebNFC scanning
    if (this.reader) {
      try {
        this.reader.removeAllListeners?.();
        this.reader = null;
      } catch (error) {
        console.warn('Error stopping WebNFC scan:', error);
      }
    }
  }

  /**
   * Extract tag ID from NFC reading event
   */
  private extractTagId(event: any): string {
    console.log('NFC Event received:', event);
    
    try {
      // Try to get serial number first
      if (event.serialNumber) {
        console.log('Using serial number:', event.serialNumber);
        return this.formatTagId(event.serialNumber);
      }
      
      // Fallback to generating ID from records
      if (event.message && event.message.records) {
        const record = event.message.records[0];
        console.log('Using record data:', record);
        if (record && record.data) {
          const dataView = new DataView(record.data);
          let id = '';
          for (let i = 0; i < Math.min(4, dataView.byteLength); i++) {
            id += dataView.getUint8(i).toString(16).padStart(2, '0');
          }
          return this.formatTagId(id);
        }
      }
      
      // Generate fallback ID from timestamp if no other data available
      console.log('No tag data found, generating ID from current time');
      return this.formatTagId(Date.now().toString().slice(-6));
      
    } catch (error) {
      console.warn('Error extracting tag ID:', error);
      // Return timestamp-based fallback ID only as last resort
      return this.formatTagId(Date.now().toString().slice(-6));
    }
  }

  /**
   * Format tag ID for consistent display
   */
  private formatTagId(rawId: string): string {
    // Remove any non-alphanumeric characters and convert to uppercase
    const cleanId = rawId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    // Ensure it starts with NFC prefix
    if (cleanId.startsWith('NFC')) {
      return cleanId.substring(0, 9); // NFC + 6 characters
    } else {
      return `NFC${cleanId.substring(0, 6)}`;
    }
  }
}

// Export singleton instance
export const nfcManager = NFCManager.getInstance();