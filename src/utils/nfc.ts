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
  private pluginInitialized: boolean = false;

  static getInstance(): NFCManager {
    if (!NFCManager.instance) {
      NFCManager.instance = new NFCManager();
    }
    return NFCManager.instance;
  }

  constructor() {
    // Don't initialize anything in constructor - wait for actual usage
  }

  /**
   * Initialize NFC plugin only when needed
   */
  private async initializePlugin(): Promise<void> {
    if (this.pluginInitialized) return;
    
    if (Capacitor.isNativePlatform()) {
      try {
        const module = await import('@exxili/capacitor-nfc');
        this.nfcPlugin = module.NFC;
        console.log('NFC plugin initialized successfully');
      } catch (error) {
        console.warn('NFC plugin not available:', error);
      }
    }
    this.pluginInitialized = true;
  }

  /**
   * Check if NFC is supported on this device
   */
  async isNFCSupported(): Promise<boolean> {
    // Initialize plugin first
    await this.initializePlugin();
    
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
    const isSupported = await this.isNFCSupported();
    if (!isSupported) return false;
    
    // For native platforms, assume permission is granted if plugin is available
    if (Capacitor.isNativePlatform()) {
      return this.nfcPlugin !== null;
    }
    
    // For web, check WebNFC permission
    try {
      const permission = await navigator.permissions.query({ name: 'nfc' as any });
      return permission.state === 'granted';
    } catch (error) {
      // If permission query fails, try to scan and see if it works
      console.warn('NFC permission check not supported, will attempt scan');
      return true;
    }
  }

  /**
   * Start scanning for NFC tags
   */
  async startScanning(): Promise<NFCReadResult> {
    // Initialize plugin first
    await this.initializePlugin();
    
    // Use native NFC plugin for iOS/Android
    if (Capacitor.isNativePlatform() && this.nfcPlugin) {
      return this.scanWithNativePlugin();
    }

    // Use WebNFC API for web browsers
    if ('NDEFReader' in window) {
      return this.scanWithWebNFC();
    }

    // No NFC support available
    return {
      tagId: '',
      success: false,
      error: 'NFC not supported on this device'
    };
  }

  /**
   * Scan using @exxili/capacitor-nfc plugin (iOS/Android)
   */
  private async scanWithNativePlugin(): Promise<NFCReadResult> {
    try {
      console.log('Starting native NFC scan...');
      
      // Start scanning for NDEF messages - this will wait for user to tap NFC tag
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
          // Generate a timestamp-based ID only if we have a real tag but no readable data
          tagId = this.formatTagId(Date.now().toString().slice(-6));
        }
        
        console.log('Generated tag ID:', tagId);

        return {
          tagId,
          success: true
        };
      } else if (result) {
        // We got a result but no NDEF records - still a real tag scan
        const fallbackTagId = this.formatTagId(Date.now().toString().slice(-6));
        console.log('Empty NFC tag detected, using fallback ID:', fallbackTagId);
        return {
          tagId: fallbackTagId,
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
      console.log('Native NFC scan error:', error);
      return {
        tagId: '',
        success: false,
        error: 'Failed to scan NFC tag. Please try again.'
      };
    }
  }

  /**
   * Scan using WebNFC API (Chrome on Android)
   */
  private async scanWithWebNFC(): Promise<NFCReadResult> {
    try {
      console.log('Starting WebNFC scan...');

      // Create new NDEFReader instance
      this.reader = new (window as any).NDEFReader();
      
      // Return a promise that resolves when a tag is scanned
      return new Promise(async (resolve, reject) => {
        let isResolved = false;
        let scanTimeout: NodeJS.Timeout;
        
        // Set up event listeners first
        const handleReading = (event: any) => {
          if (isResolved) return;
          isResolved = true;
          
          clearTimeout(scanTimeout);
          console.log('WebNFC tag detected:', event);
          
          const tagId = this.extractTagId(event);
          if (tagId) {
            resolve({
              tagId,
              success: true
            });
          } else {
            // Generate fallback ID if we can't extract one
            const fallbackTagId = this.formatTagId(Date.now().toString().slice(-8));
            resolve({
              tagId: fallbackTagId,
              success: true
            });
          }
        };

        const handleError = (error: any) => {
          if (isResolved) return;
          isResolved = true;
          
          clearTimeout(scanTimeout);
          console.log('WebNFC reading error:', error);
          resolve({
            tagId: '',
            success: false,
            error: 'Failed to read NFC tag. Please try again.'
          });
        };

        // Add event listeners
        this.reader.addEventListener('reading', handleReading);
        this.reader.addEventListener('readingerror', handleError);

        // Set timeout (30 seconds)
        scanTimeout = setTimeout(() => {
          if (isResolved) return;
          isResolved = true;
          
          // Clean up listeners
          this.reader.removeEventListener('reading', handleReading);
          this.reader.removeEventListener('readingerror', handleError);
          
          resolve({
            tagId: '',
            success: false,
            error: 'NFC scan timeout. Please tap an NFC tag.'
          });
        }, 30000);

        try {
          // Start scanning - this will wait for user to tap an NFC tag
          await this.reader.scan();
          console.log('WebNFC scanning started, waiting for tag...');
        } catch (scanError: any) {
          if (isResolved) return;
          isResolved = true;
          
          clearTimeout(scanTimeout);
          console.log('WebNFC scan start error:', scanError);
          
          // Clean up listeners
          this.reader.removeEventListener('reading', handleReading);
          this.reader.removeEventListener('readingerror', handleError);
          
          let errorMessage = 'Failed to start NFC scanning.';
          if (scanError.name === 'NotAllowedError') {
            errorMessage = 'NFC permission denied. Please enable NFC in browser settings.';
          } else if (scanError.name === 'NotSupportedError') {
            errorMessage = 'NFC not supported in this browser. Use Chrome on Android.';
          }
          
          resolve({
            tagId: '',
            success: false,
            error: errorMessage
          });
        }
      });
      
    } catch (error: any) {
      console.log('WebNFC scan error:', error);
      return {
        tagId: '',
        success: false,
        error: 'WebNFC not available. Please use Chrome on Android.'
      };
    }
  }

  /**
   * Stop NFC scanning
   */
  stopScanning(): void {
    console.log('Stopping NFC scan...');
    
    // Stop native NFC scanning - this plugin doesn't require explicit stop
    if (Capacitor.isNativePlatform() && this.nfcPlugin) {
      console.log('NFC scan completed (native)');
    }

    // Stop WebNFC scanning
    if (this.reader) {
      try {
        // Remove all event listeners
        this.reader.removeEventListener('reading', null);
        this.reader.removeEventListener('readingerror', null);
        this.reader = null;
        console.log('WebNFC scan stopped');
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
      console.log('No tag data found, cannot generate ID');
      return '';
      
    } catch (error) {
      console.warn('Error extracting tag ID:', error);
      // Return empty string on error - don't generate fake IDs
      return '';
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

// Create a lazy-loaded singleton instance
let _instance: NFCManager | null = null;

export const nfcManager = {
  get startScanning() {
    if (!_instance) _instance = NFCManager.getInstance();
    return _instance.startScanning.bind(_instance);
  },
  get stopScanning() {
    if (!_instance) _instance = NFCManager.getInstance();
    return _instance.stopScanning.bind(_instance);
  },
  get isNFCSupported() {
    if (!_instance) _instance = NFCManager.getInstance();
    return _instance.isNFCSupported.bind(_instance);
  },
  get checkNFCPermission() {
    if (!_instance) _instance = NFCManager.getInstance();
    return _instance.checkNFCPermission.bind(_instance);
  }
};