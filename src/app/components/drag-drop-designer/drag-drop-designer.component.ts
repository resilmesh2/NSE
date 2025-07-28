import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { NetworkDataService } from '../../services/network-data.service';
import { RiskComponentsService, RiskComponent } from '../../services/risk-components.service';

interface CalculationMethod {
  id: string;
  name: string;
  type: string;
  icon: string;
  description: string;
}

@Component({
  selector: 'app-drag-drop-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './drag-drop-designer.component.html',
  styleUrls: ['./drag-drop-designer.component.css']
})
export class DragDropDesignerComponent implements OnInit {
  // Risk calculation components
  availableComponents: RiskComponent[] = [];
  riskFormula: RiskComponent[] = [];
  isLoadingComponents = true;

  showIpModal = false;
  availableIpAddresses: any[] = [];
  filteredIpAddresses: any[] = [];
  selectedIps: boolean[] = [];
  selectAllIps = false;
  ipSearchTerm = '';

  showConfirmModal = false;
  showAlertModal = false;
  confirmModalData: {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  thirdButtonText?: string;
  onThirdButton?: () => void;
} = {
  title: '',
  message: '',
  confirmText: 'OK',
  cancelText: 'Cancel',
  onConfirm: () => {},
  onCancel: () => {}
};
  alertModalData = {
    title: '',
    message: '',
    buttonText: 'OK',
    onClose: () => {}
  };

notifications: Array<{
  id: number;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
}> = [];

private notificationId = 0;

  targetProperty = 'Risk Score';

  // Calculation methods
  availableMethods: CalculationMethod[] = [
    { id: 'weighted_avg', name: 'Weighted Average', type: 'calculation', icon: '⚖️', description: 'Components * weights / total weights' },
    { id: 'max', name: 'Maximum Score', type: 'calculation', icon: '📈', description: 'Highest component score' },
    { id: 'sum', name: 'Sum Total', type: 'calculation', icon: '➕', description: 'Add all component scores' },
    { id: 'geometric_mean', name: 'Geometric Mean', type: 'calculation', icon: '🔢', description: 'nth root of product' },
    { id: 'custom_formula', name: 'Custom Formula', type: 'calculation', icon: '🧮', description: 'User-defined calculation' }
  ];

  selectedMethod = 'weighted_avg';
  customFormula = '';

  // Modal states
  showConfigModal = false;
  showNetworkModal = false;
  showSubnetModal = false;
  
  availableNetworks: any[] = [];
  availableSubnets: any[] = [];

  // Multi-select network properties
  selectedNetworks: boolean[] = [];
  selectAllNetworks = false;

  showCustomComponentModal = false;
  customComponent = {
    name: '',
    category: '',
    maxValue: 10
  };

  constructor(
    private networkDataService: NetworkDataService,
    private riskComponentsService: RiskComponentsService
  ) {}

  async ngOnInit() {
    this.isLoadingComponents = true;
    
    try {
      this.availableComponents = await this.riskComponentsService.loadComponents();
      console.log('Loaded ISIM components:', this.availableComponents.length);
      
      // Log each component for debugging
      this.availableComponents.forEach(comp => {
        console.log(`Component: ${comp.name}, ISIM Property: ${comp.neo4jProperty}, Current Value: ${comp.currentValue}`);
      });
      
    } catch (error) {
      console.error('Failed to load ISIM components, using fallbacks:', error);
      this.availableComponents = this.riskComponentsService.getComponents();
    }
    
    this.isLoadingComponents = false;
    this.loadNetworkData();
  }
  
  private loadNetworkData() {
    const currentData = this.networkDataService.getCurrentNetworkData();
    
    // Extract unique networks
    const networkMap = new Map();
    currentData.forEach(subnet => {
      const networkPrefix = subnet.subnet.split('.').slice(0, 2).join('.');
      if (!networkMap.has(networkPrefix)) {
        networkMap.set(networkPrefix, {
          prefix: networkPrefix,
          subnets: [],
          totalDevices: 0
        });
      }
      const network = networkMap.get(networkPrefix);
      network.subnets.push(subnet);
      network.totalDevices += subnet.deviceCount;
    });

    this.availableNetworks = Array.from(networkMap.values());
    this.availableSubnets = currentData.slice(0, 20);
    
    // Initialize selection arrays
    this.selectedNetworks = new Array(this.availableNetworks.length).fill(false);
  }

  private async loadIpAddresses() {
    console.log('Loading IP addresses...');
    this.availableIpAddresses = [];
    
    try {
      // Get all network data
      const networkData = this.networkDataService.getCurrentNetworkData();
      console.log('Network data:', networkData.length, 'subnets');
      
      // If no devices loaded, we need to create mock IPs from subnets
      networkData.forEach(subnet => {
        if (subnet.devices && subnet.devices.length > 0) {
          // Use device IPs if available
          subnet.devices.forEach(device => {
            if (device.ip) {
              this.availableIpAddresses.push({
                ip: device.ip,
                subnet: subnet.subnet,
                riskScore: device.riskScore || 0,
                hostname: device.hostname || 'Unknown',
                deviceData: device
              });
            }
          });
        } else {
          // Generate sample IPs from subnet range for demonstration
          const baseIp = subnet.subnet.split('/')[0];
          const baseOctets = baseIp.split('.');
          
          // Create 3-5 sample IPs per subnet
          const ipCount = Math.min(5, Math.max(3, subnet.deviceCount || 3));
          for (let i = 1; i <= ipCount; i++) {
            const lastOctet = Math.floor(Math.random() * 200) + 10; // Random IP in range
            const sampleIp = `${baseOctets[0]}.${baseOctets[1]}.${baseOctets[2]}.${lastOctet}`;
            
            this.availableIpAddresses.push({
              ip: sampleIp,
              subnet: subnet.subnet,
              riskScore: subnet.riskScore || 0,
              hostname: `host-${lastOctet}`,
              deviceData: null
            });
          }
        }
      });
      
      // Sort by IP address
      this.availableIpAddresses.sort((a, b) => {
        const aOctets = a.ip.split('.').map(Number);
        const bOctets = b.ip.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
          if (aOctets[i] !== bOctets[i]) {
            return aOctets[i] - bOctets[i];
          }
        }
        return 0;
      });
      
      // Take first 50 for performance
      this.availableIpAddresses = this.availableIpAddresses.slice(0, 50);
      this.filteredIpAddresses = [...this.availableIpAddresses];
      this.selectedIps = new Array(this.availableIpAddresses.length).fill(false);
      this.selectAllIps = false;
      this.ipSearchTerm = '';
      
      console.log(`Loaded ${this.availableIpAddresses.length} IP addresses for selection`);
      
    } catch (error) {
      console.error('Error loading IP addresses:', error);
      this.showError('Loading Error', 'Error loading IP addresses. Please check the console.');
    }
  }

  private async askCalculationMode(): Promise<'setValue' | 'calculate' | null> {
    const message = `Choose calculation mode:

    <strong>Set Specific Values</strong> - Uses the current values you set in the formula
    <strong>Calculate from Sample Result</strong> - Uses Node property values from ISIM

    For Test2 example:
    - Set Values: Test2 = 10 (uses your input)
    - Calculate: Test2 = Risk Score * 0.4`;

      const useSetValues = await this.showConfirm(
        'Choose Calculation Mode',
        message,
        'Set Specific Values',
        'Calculate from Sample Result'
      );

      // Return the choice directly without a second confirmation
      return useSetValues ? 'setValue' : 'calculate';
  }

filterIpAddresses() {
  if (!this.ipSearchTerm.trim()) {
    this.filteredIpAddresses = [...this.availableIpAddresses];
  } else {
    const searchTerm = this.ipSearchTerm.toLowerCase();
    this.filteredIpAddresses = this.availableIpAddresses.filter(ip => 
      ip.ip.includes(searchTerm) || 
      ip.hostname.toLowerCase().includes(searchTerm) ||
      ip.subnet.includes(searchTerm)
    );
  }
  
  // Reset selections when filtering
  this.selectedIps = new Array(this.filteredIpAddresses.length).fill(false);
  this.selectAllIps = false;
}

toggleAllIps(event: any) {
  const selectAll = event.target.checked;
  this.selectedIps = new Array(this.filteredIpAddresses.length).fill(selectAll);
  this.selectAllIps = selectAll;
}

updateIpSelection() {
  const selectedCount = this.getSelectedIpsCount();
  const totalCount = this.filteredIpAddresses.length;
  
  if (selectedCount === 0) {
    this.selectAllIps = false;
  } else if (selectedCount === totalCount) {
    this.selectAllIps = true;
  } else {
    this.selectAllIps = false;
  }
}

isSelectAllIpsIndeterminate(): boolean {
  const selectedCount = this.getSelectedIpsCount();
  const totalCount = this.filteredIpAddresses.length;
  return selectedCount > 0 && selectedCount < totalCount;
}

getSelectedIpsCount(): number {
  return this.selectedIps.filter(selected => selected).length;
}

getSelectedIpsCountText(): string {
  const count = this.getSelectedIpsCount();
  if (count === 0) {
    return '0 IPs selected';
  } else if (count === 1) {
    return '1 IP selected';
  } else {
    return `${count} IPs selected`;
  }
}

closeIpModal() {
  this.showIpModal = false;
  this.selectedIps = [];
  this.ipSearchTerm = '';
  this.selectAllIps = false;
}

  drop(event: CdkDragDrop<RiskComponent[]>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );
    }
    
    // Auto-update custom formula when components change
    if (this.selectedMethod === 'custom_formula') {
      this.updateCustomFormulaFromComponents();
    }
  }

  removeFromFormula(index: number) {
    const item = this.riskFormula[index];
    this.riskFormula.splice(index, 1);
    this.availableComponents.push(item);
    
    if (this.selectedMethod === 'custom_formula') {
      this.updateCustomFormulaFromComponents();
    }
  }

  clearFormula() {
    this.availableComponents.push(...this.riskFormula);
    this.riskFormula = [];
    
    if (this.selectedMethod === 'custom_formula') {
      this.customFormula = '';
    }
  }

  onMethodChange(methodId: string) {
    this.selectedMethod = methodId;
    
    if (methodId === 'custom_formula') {
      this.updateCustomFormulaFromComponents();
    }
  }

  updateWeight(component: RiskComponent, event: any) {
    const newWeight = parseFloat((event.target as HTMLInputElement).value);
    component.weight = newWeight;
  }

  updateMaxValue(component: RiskComponent, event: any) {
    const newMaxValue = parseFloat((event.target as HTMLInputElement).value);
    component.maxValue = newMaxValue;
    if (component.currentValue && component.currentValue > newMaxValue) {
      component.currentValue = newMaxValue;
    }
  }

  updateCurrentValue(component: RiskComponent, event: any) {
    const newCurrentValue = parseFloat((event.target as HTMLInputElement).value);
    component.currentValue = Math.min(newCurrentValue, component.maxValue);
  }

  // Simulate risk calculation preview using data
  calculatePreviewRisk(): number {
    if (this.riskFormula.length === 0) return 0;

    switch (this.selectedMethod) {
      case 'weighted_avg':
        const totalWeighted = this.riskFormula.reduce((sum, comp) => {
          const value = comp.currentValue || comp.statistics?.avg || 0;
          return sum + (value * comp.weight);
        }, 0);
        const totalWeights = this.riskFormula.reduce((sum, comp) => sum + comp.weight, 0);
        return totalWeights > 0 ? totalWeighted / totalWeights : 0;
      
      case 'max':
        return Math.max(...this.riskFormula.map(comp => comp.currentValue || comp.statistics?.avg || 0));
      
      case 'sum':
        return this.riskFormula.reduce((sum, comp) => sum + (comp.currentValue || comp.statistics?.avg || 0), 0);

      case 'custom_formula':
        if (!this.customFormula.trim()) return 0;
        
        try {
          let formulaToEvaluate = this.customFormula;
          
          this.riskFormula.forEach(comp => {
            const value = comp.currentValue || comp.statistics?.avg || 0;
            const regex = new RegExp(comp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            formulaToEvaluate = formulaToEvaluate.replace(regex, value.toFixed(2));
          });
          
          const result = this.evaluateSimpleExpression(formulaToEvaluate);
          return Math.max(0, Math.min(result, 10));
        } catch (error) {
          const totalWeighted = this.riskFormula.reduce((sum, comp) => {
            const value = comp.currentValue || comp.statistics?.avg || 0;
            return sum + (value * comp.weight);
          }, 0);
          return Math.min(totalWeighted, 10);
        }

      case 'geometric_mean':
        const product = this.riskFormula.reduce((prod, comp) => {
          const value = comp.currentValue || comp.statistics?.avg || 1;
          return prod * Math.max(value, 0.1);
        }, 1);
        return Math.pow(product, 1 / this.riskFormula.length);
      
      default:
        return 0;
    }
  }

  getResultRiskClass(riskScore: number): string {
    if (riskScore >= 9.0) return 'result-critical';
    if (riskScore >= 7.0) return 'result-high'; 
    if (riskScore >= 4.0) return 'result-medium';
    return 'result-low';
  }

  private evaluateSimpleExpression(expression: string): number {
    try {
      const cleanExpression = expression.replace(/\s+/g, '');
      
      if (!/^[\d+\-*/().^]+$/.test(cleanExpression)) {
        throw new Error('Invalid characters in expression');
      }
      
      const jsExpression = cleanExpression.replace(/\^/g, '**');
      const result = new Function('return ' + jsExpression)();
      
      return isNaN(result) ? 0 : result;
    } catch (error) {
      console.warn('Formula evaluation error:', error);
      return 0;
    }
  }

// Notification helper methods
private showNotification(type: 'success' | 'info' | 'warning' | 'error', title: string, message: string) {
  const notification = {
    id: ++this.notificationId,
    type,
    title,
    message,
    timestamp: Date.now()
  };
  
  this.notifications.push(notification);
  
  // Auto-dismiss after 5 seconds (except for errors which stay longer)
  const dismissTime = type === 'error' ? 8000 : 5000;
  setTimeout(() => {
    this.dismissNotification(notification.id);
  }, dismissTime);
}

private showSuccess(title: string, message: string) {
  this.showNotification('success', title, message);
}

private showError(title: string, message: string) {
  this.showNotification('error', title, message);
}

private showWarning(title: string, message: string) {
  this.showNotification('warning', title, message);
}

private showInfo(title: string, message: string) {
  this.showNotification('info', title, message);
}

dismissNotification(id: number) {
  this.notifications = this.notifications.filter(n => n.id !== id);
}

getNotificationIcon(type: string): string {
  switch(type) {
    case 'success': return '✅';
    case 'error': return '❌';
    case 'warning': return '⚠️';
    case 'info': return 'ℹ️';
    default: return 'ℹ️';
  }
}

// Modal helper methods
private showConfirm(title: string, message: string, confirmText: string = 'OK', cancelText: string = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    this.confirmModalData = {
      title,
      message,
      confirmText,
      cancelText,
      onConfirm: () => {
        this.closeConfirmModal();
        resolve(true);
      },
      onCancel: () => {
        this.closeConfirmModal();
        resolve(false);
      }
    };
    this.showConfirmModal = true;
  });
}

// Three-button confirmation modal
private showThreeButtonConfirm(title: string, message: string, button1Text: string, button2Text: string, button3Text: string): Promise<'button1' | 'button2' | 'button3'> {
  return new Promise((resolve) => {
    // Extend your existing confirmModalData to support three buttons
    this.confirmModalData = {
      title,
      message,
      confirmText: button1Text,
      cancelText: button2Text,
      onConfirm: () => {
        this.closeConfirmModal();
        resolve('button1');
      },
      onCancel: () => {
        this.closeConfirmModal();
        resolve('button2');
      }
    };
    
    // Add a third button handler
    this.confirmModalData.thirdButtonText = button3Text;
    this.confirmModalData.onThirdButton = () => {
      this.closeConfirmModal();
      resolve('button3');
    };
    
    this.showConfirmModal = true;
  });
}

private showAlert(title: string, message: string, buttonText: string = 'OK'): Promise<void> {
  return new Promise((resolve) => {
    this.alertModalData = {
      title,
      message,
      buttonText,
      onClose: () => {
        this.closeAlertModal();
        resolve();
      }
    };
    this.showAlertModal = true;
  });
}

closeConfirmModal() {
  this.showConfirmModal = false;
}

closeAlertModal() {
  this.showAlertModal = false;
}

  isCustomFormulaEdited(): boolean {
    if (!this.customFormula.trim() || this.riskFormula.length === 0) {
      return false;
    }
    
    const defaultFormula = this.riskFormula.map(c => c.name).join(' + ');
    return this.customFormula.trim() !== defaultFormula;
  }

  getWeightedFormulaExpression(): string {
    if (this.riskFormula.length === 0) return '';
    const components = this.riskFormula.map(c => `${c.name}×${c.weight}`).join(' + ');
    const totalWeight = this.getTotalWeight();
    return `(${components}) ÷ ${totalWeight}`;
  }

  getMaxFormulaExpression(): string {
    if (this.riskFormula.length === 0) return '';
    return `MAX(${this.riskFormula.map(c => c.name).join(', ')})`;
  }

  getSumFormulaExpression(): string {
    if (this.riskFormula.length === 0) return '';
    return this.riskFormula.map(c => c.name).join(' + ');
  }

  getGenericFormulaExpression(): string {
    if (this.riskFormula.length === 0) return '';
    return this.riskFormula.map(c => c.name).join(' ○ ');
  }

  private async writeCustomComponentsToNodes(targetType: string, targetValues: any[]): Promise<void> {
  // Find custom components that need to be written to nodes first
  const customComponents = this.riskFormula.filter(comp => 
    comp.type === 'custom' && 
    comp.neo4jProperty !== this.targetProperty
  );
  
  if (customComponents.length === 0) {
    return; // No custom components to write
  }
  
  console.log(`Writing ${customComponents.length} custom components to nodes first...`);
  
  for (const customComp of customComponents) {
    try {
      await this.riskComponentsService.writeCustomComponent(
        customComp.name,
        customComp.neo4jProperty,
        customComp.currentValue?.toString() || '0', // Write the current value as a simple value
        'setValue', // Always use setValue for individual custom components
        [customComp],
        targetType,
        targetValues,
        'setValue'
      );
      console.log(`Successfully wrote custom component: ${customComp.neo4jProperty}`);
    } catch (error) {
      console.warn(`Failed to write custom component ${customComp.neo4jProperty}:`, error);
    }
  }
}

  private updateCustomFormulaFromComponents(): void {
    if (this.riskFormula.length === 0) {
      this.customFormula = '';
      return;
    }
    
    const isDefaultFormula = !this.customFormula.trim() || 
      this.customFormula.match(/^[^+*/()^-]+(\s*\+\s*[^+*/()^-]+)*$/);
    
    if (isDefaultFormula) {
      const componentNames = this.riskFormula.map(c => c.name);
      this.customFormula = componentNames.join(' + ');
    } else {
      const existingComponents = this.getComponentNamesFromFormula();
      const newComponents = this.riskFormula
        .map(c => c.name)
        .filter(name => !existingComponents.includes(name));
      
      if (newComponents.length > 0) {
        this.customFormula += ' + ' + newComponents.join(' + ');
      }
    }
  }

  private getComponentNamesFromFormula(): string[] {
    const componentNames = this.riskFormula.map(c => c.name);
    return componentNames.filter(name => 
      this.customFormula.toLowerCase().includes(name.toLowerCase())
    );
  }

getCategoryIcon(category: string): string {
  const icons: { [key: string]: string } = {
    'security': '🔒',
    'performance': '⚡',
    'compliance': '📋',
    'business': '💼',
    'technical': '⚙️',
    'custom': '🔧'
  };
  return icons[category] || '🔧';
}

getAutoDescription(): string {
  if (!this.customComponent.category) return 'Component description...';
  const category = this.customComponent.category.charAt(0).toUpperCase() + this.customComponent.category.slice(1);
  return `${category} component for risk assessment`;
}

  getTotalWeight(): number {
    return this.riskFormula.reduce((sum, c) => sum + (c.weight || 0), 0);
  }

  getComponentCount(): number {
    return this.riskFormula.length;
  }

  getSelectedMethodDisplay(): string {
    if (this.selectedMethod === 'custom_formula') {
      return this.customFormula.trim() || 'custom formula';
    }
    return this.selectedMethod.replace('_', ' ');
  }

  // Show component statistics
  getComponentStatistics(component: RiskComponent): string {
    if (!component.statistics) return 'No statistics available';
    
    const stats = component.statistics;
    return `Avg: ${stats.avg?.toFixed(2) || 'N/A'}, Max: ${stats.max?.toFixed(2) || 'N/A'}, Min: ${stats.min?.toFixed(2) || 'N/A'}`;
  }

  // Configuration application methods
saveConfiguration() {
  if (this.riskFormula.length === 0) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  // Show the configuration modal instead of immediate save
  this.showConfigModal = true;
}

async applyToSelectedNetworks() {
  const selectedNetworkIndices = this.selectedNetworks
    .map((selected, index) => selected ? index : -1)
    .filter(index => index !== -1);
  
  if (selectedNetworkIndices.length === 0) {
    this.showWarning('Selection Required', 'Please select at least one network to apply the configuration.');
    return;
  }
  
  const selectedNetworkData = selectedNetworkIndices.map(index => this.availableNetworks[index]);
  
  const propertyToUpdate = this.getPropertyToUpdate();
  if (!propertyToUpdate) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  // Close the network selection modal now that selection is validated
  this.closeNetworkModal();
  
  let calculationMode: 'setValue' | 'calculate' | null = null;
  
  // Loop until user confirms or cancels
  while (true) {
    // Ask user which mode they want
    calculationMode = await this.askCalculationMode();
    if (!calculationMode) return; // User cancelled from calculation mode selection
    
    // Show confirmation with details and Back option
    const networkNames = selectedNetworkData.map(n => n.prefix + '.x.x').join(', ');
    let confirmMessage = '';
    if (calculationMode === 'setValue') {
      const values = this.riskFormula.map(comp => `${comp.name}: ${comp.currentValue || 0}`).join('\n');
      confirmMessage = `Set "${propertyToUpdate}" to calculated value on Node objects in selected networks?\n\nNetworks: ${networkNames}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nValues to use:\n${values}\n\nThis will set "${propertyToUpdate}" to the calculated result. Continue?`;
    } else {
      confirmMessage = `Calculate "${propertyToUpdate}" using existing Node property values in selected networks?\n\nNetworks: ${networkNames}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nThis will use property values from Node objects. Continue?`;
    }
    
    const result = await this.showThreeButtonConfirm(
      'Apply to Networks', 
      confirmMessage, 
      'Apply', 
      'Cancel', 
      'Back to Mode Selection'
    );
    
    if (result === 'button1') { // Apply
      break; // Exit loop and proceed with application
    } else if (result === 'button2') { // Cancel
      return; // Exit method completely
    }
    // If result === 'button3' (Back), the loop continues and askCalculationMode runs again
  }
  
  try {
    // Write custom components first
    await this.writeCustomComponentsToNodes('network', selectedNetworkData);
    
    // Then update the target property with the calculated result
    const result = await this.riskComponentsService.writeCustomComponent(
      propertyToUpdate,
      propertyToUpdate,
      this.customFormula || this.getSumFormulaExpression(),
      this.selectedMethod,
      this.riskFormula,
      'network',
      selectedNetworkData,
      calculationMode
    );
    
    this.showSuccess('Configuration Applied', `Updated ${result.results.updatedNodes} nodes across ${selectedNetworkData.length} networks`);
    
    this.selectedNetworks = new Array(this.availableNetworks.length).fill(false);
    this.selectAllNetworks = false;
    await this.refreshComponents();
    
  } catch (error) {
    console.error('Error applying to networks:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.showError('Update Failed', `Error updating Node property:\n\n${errorMessage}`);
  }
}

async applyToSubnet(subnet: any) {
  this.closeSubnetModal();
  
  const propertyToUpdate = this.getPropertyToUpdate();
  if (!propertyToUpdate) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  let calculationMode: 'setValue' | 'calculate' | null = null;
  
  // Loop until user confirms or cancels
  while (true) {
    // Ask user which mode they want
    calculationMode = await this.askCalculationMode();
    if (!calculationMode) return; // User cancelled from calculation mode selection
    
    // Show confirmation with details and Back option
    let confirmMessage = '';
    if (calculationMode === 'setValue') {
      const values = this.riskFormula.map(comp => `${comp.name}: ${comp.currentValue || 0}`).join('\n');
      confirmMessage = `Set "${propertyToUpdate}" to calculated value on Node objects in subnet ${subnet.subnet}?\n\nMethod: ${this.selectedMethod.replace('_', ' ')}\nValues to use:\n${values}\n\nThis will set "${propertyToUpdate}" to the calculated result. Continue?`;
    } else {
      confirmMessage = `Calculate "${propertyToUpdate}" using existing Node property values in subnet ${subnet.subnet}?\n\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nThis will use  property values from Node objects. Continue?`;
    }
    
    const result = await this.showThreeButtonConfirm(
      'Apply to Subnet', 
      confirmMessage, 
      'Apply', 
      'Cancel', 
      'Back to Mode Selection'
    );
    
    if (result === 'button1') { // Apply
      break; // Exit loop and proceed with application
    } else if (result === 'button2') { // Cancel
      return; // Exit method completely
    }
    // If result === 'button3' (Back), the loop continues and askCalculationMode runs again
  }
  
  // Rest of your existing applyToSubnet logic...
  try {
    await this.writeCustomComponentsToNodes('subnet', [subnet]);

    const result = await this.riskComponentsService.writeCustomComponent(
      propertyToUpdate,
      propertyToUpdate,
      this.customFormula || this.getSumFormulaExpression(),
      this.selectedMethod,
      this.riskFormula,
      'subnet',
      [subnet],
      calculationMode
    );
    
    this.showSuccess('Configuration Applied', `Updated ${result.results.updatedNodes} nodes in ${subnet.subnet}`);
    await this.refreshComponents();
    
  } catch (error) {
    console.error('Error applying to subnet:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.showError('Update Failed', `Error updating Node property:\n\n${errorMessage}`);
  }
}

async applyToSelectedIps() {
  const selectedIpIndices = this.selectedIps
    .map((selected, index) => selected ? index : -1)
    .filter(index => index !== -1);
  
  if (selectedIpIndices.length === 0) {
    this.showWarning('Selection Required', 'Please select at least one IP address.');
    return;
  }
  
  const selectedIpData = selectedIpIndices.map(index => this.filteredIpAddresses[index]);
  
  const propertyToUpdate = this.getPropertyToUpdate();
  if (!propertyToUpdate) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  // Close the IP selection modal now that selection is validated
  this.closeIpModal();
  
  let calculationMode: 'setValue' | 'calculate' | null = null;
  
  // Loop until user confirms or cancels
  while (true) {
    // Ask user which mode they want
    calculationMode = await this.askCalculationMode();
    if (!calculationMode) return; // User cancelled from calculation mode selection
    
    // Show confirmation with details and Back option
    const ipAddresses = selectedIpData.map(ip => ip.ip).join(', ');
    const displayIps = ipAddresses.length > 100 ? ipAddresses.substring(0, 100) + '...' : ipAddresses;
    let confirmMessage = '';
    if (calculationMode === 'setValue') {
      const values = this.riskFormula.map(comp => `${comp.name}: ${comp.currentValue || 0}`).join('\n');
      confirmMessage = `Set "${propertyToUpdate}" to calculated value on Node objects for selected IPs?\n\nIPs: ${displayIps}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nValues to use:\n${values}\n\nThis will set "${propertyToUpdate}" to the calculated result. Continue?`;
    } else {
      confirmMessage = `Calculate "${propertyToUpdate}" using existing Node property values for selected IPs?\n\nIPs: ${displayIps}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nThis will use  property values from Node objects. Continue?`;
    }
    
    const result = await this.showThreeButtonConfirm(
      'Apply to IP Addresses', 
      confirmMessage, 
      'Apply', 
      'Cancel', 
      'Back to Mode Selection'
    );
    
    if (result === 'button1') { // Apply
      break; // Exit loop and proceed with application
    } else if (result === 'button2') { // Cancel
      return; // Exit method completely
    }
    // If result === 'button3' (Back), the loop continues and askCalculationMode runs again
  }
  
  try {
    await this.writeCustomComponentsToNodes('ip', selectedIpData);

    const result = await this.riskComponentsService.writeCustomComponent(
      propertyToUpdate,
      propertyToUpdate,
      this.customFormula || this.getSumFormulaExpression(),
      this.selectedMethod,
      this.riskFormula,
      'ip',
      selectedIpData,
      calculationMode
    );
    
    this.showSuccess('Configuration Applied', `Updated ${result.results.updatedNodes} nodes for ${selectedIpData.length} IP addresses`);
    
    this.selectedIps = [];
    this.selectAllIps = false;
    await this.refreshComponents();
    
  } catch (error) {
    console.error('Error applying to IPs:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.showError('Update Failed', `Error updating Node property:\n\n${errorMessage}`);
  }
}

async applyToRandomSample() {
  const sampleSize = Math.min(10, this.availableSubnets.length);
  const sample = this.availableSubnets.slice(0, sampleSize);
  
  const propertyToUpdate = this.getPropertyToUpdate();
  if (!propertyToUpdate) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  let calculationMode: 'setValue' | 'calculate' | null = null;
  
  // Loop until user confirms or cancels
  while (true) {
    // Ask user which mode they want
    calculationMode = await this.askCalculationMode();
    if (!calculationMode) return; // User cancelled from calculation mode selection
    
    // Show confirmation with details and Back option
    let confirmMessage = '';
    if (calculationMode === 'setValue') {
      const values = this.riskFormula.map(comp => `${comp.name}: ${comp.currentValue || 0}`).join('\n');
      confirmMessage = `Set "${propertyToUpdate}" to calculated value on Node objects in ${sampleSize} sample subnets?\n\nMethod: ${this.selectedMethod.replace('_', ' ')}\nValues to use:\n${values}\n\nSample subnets: ${sample.slice(0, 3).map(s => s.subnet).join(', ')}${sample.length > 3 ? '...' : ''}\n\nThis will set "${propertyToUpdate}" to the calculated result. Continue?`;
    } else {
      confirmMessage = `Calculate "${propertyToUpdate}" using existing Node property values in ${sampleSize} sample subnets?\n\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nSample subnets: ${sample.slice(0, 3).map(s => s.subnet).join(', ')}${sample.length > 3 ? '...' : ''}\n\nThis will use  property values from Node objects. Continue?`;
    }
    
    const result = await this.showThreeButtonConfirm(
      'Apply to Sample', 
      confirmMessage, 
      'Apply', 
      'Cancel', 
      'Back to Mode Selection'
    );
    
    if (result === 'button1') { // Apply
      break; // Exit loop and proceed with application
    } else if (result === 'button2') { // Cancel
      return; // Exit method completely
    }
    // If result === 'button3' (Back), the loop continues and askCalculationMode runs again
  }
  
  try {
    await this.writeCustomComponentsToNodes('sample', sample);

    const result = await this.riskComponentsService.writeCustomComponent(
      propertyToUpdate,
      propertyToUpdate,
      this.customFormula || this.getSumFormulaExpression(),
      this.selectedMethod,
      this.riskFormula,
      'sample',
      sample,
      calculationMode
    );
    
    this.showSuccess('Configuration Applied', `Updated ${result.results.updatedNodes} nodes in ${sampleSize} sample subnets`);
    await this.refreshComponents();
    
  } catch (error) {
    console.error('Error applying to sample:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.showError('Update Failed', `Error updating Node property:\n\n${errorMessage}`);
  }
}

private getPropertyToUpdate(): string | null {
  if (this.riskFormula.length === 0) {
    return null;
  }
  
  return this.targetProperty || 'Risk Score';
}

async testConfiguration() {
  if (this.riskFormula.length === 0) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  const testResult = this.calculatePreviewRisk();
  const riskLevel = testResult >= 8 ? 'Critical' : testResult >= 6 ? 'High' : testResult >= 4 ? 'Medium' : 'Low';
  
  const componentInfo = this.riskFormula.map(comp => {
    const value = comp.currentValue || comp.statistics?.avg || 0;
    return `${comp.name}: ${value.toFixed(2)} (ISIM: ${comp.neo4jProperty})`;
  }).join('\n');
  
  const writeToDb = confirm(`Test Results using ISIM Data:\n\nSample Risk Score: ${testResult.toFixed(2)}\nRisk Level: ${riskLevel}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nComponent Values:\n${componentInfo}\n\nDo you want to write this as a test component to ISIM?`);
  
  if (writeToDb) {
    const testPropertyName = prompt('Enter a test property name:', 'testRiskFormula');
    if (!testPropertyName) return;
    
    const cleanTestName = testPropertyName.trim().replace(/[^a-zA-Z0-9_]/g, '_');
    
    try {
      const result = await this.riskComponentsService.writeCustomComponent(
        'Test Formula',
        cleanTestName,
        this.customFormula || this.getSumFormulaExpression(),
        this.selectedMethod,
        this.riskFormula,
        'all',
        []
      );
      
      this.showSuccess('Test Component Created', `Test component written to ISIM!\n\nProperty: ${result.results.neo4jProperty}\nUpdated Nodes: ${result.results.updatedNodes}\nAverage Value: ${result.results.avgValue}\n\nYou can now see the "${cleanTestName}" property in your ISIM browser.`);
      
    } catch (error) {
      console.error('Error writing test component:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.showError('Test Failed', `Error writing test component: ${errorMessage}`);
    }
  }
}

async refreshComponents() {
  try {
    console.log('Refreshing components from ISIM...');
    this.isLoadingComponents = true;
    
    this.availableComponents = await this.riskComponentsService.loadComponents();
    console.log(`Refreshed ${this.availableComponents.length} components`);
    
    this.isLoadingComponents = false;
  } catch (error) {
    console.error('Error refreshing components:', error);
    this.isLoadingComponents = false;
  }
}

  addCustomComponent() {
    this.customComponent = {
      name: '',
      category: '',
      maxValue: 10
    };
    this.showCustomComponentModal = true;
  }

  closeCustomComponentModal() {
    this.showCustomComponentModal = false;
    this.customComponent = {
      name: '',
      category: '',
      maxValue: 10
    };
  }
  
  saveCustomComponent() {
  if (!this.customComponent.name.trim()) {
    this.showWarning('Validation Error', 'Please enter a component name');
    return;
  }
  
  if (!this.customComponent.category) {
    this.showWarning('Validation Error', 'Please select a component category');
    return;
  }
  
  if (this.customComponent.maxValue < 1 || this.customComponent.maxValue > 10) {
    this.showWarning('Validation Error', 'Max value must be between 1 and 10');
    return;
  }
  
  // Generate description based on category
  const autoDescription = `${this.customComponent.category.charAt(0).toUpperCase() + this.customComponent.category.slice(1)} component for risk assessment`;
  
  // Set appropriate icon based on category
  const categoryIcons: { [key: string]: string } = {
    'security': '🔒',
    'performance': '⚡',
    'compliance': '📋',
    'business': '💼',
    'technical': '⚙️',
    'custom': '🔧'
  };
  
  const newComponent: RiskComponent = {
    id: Date.now(),
    name: this.customComponent.name.trim(),
    type: 'custom',
    icon: categoryIcons[this.customComponent.category] || '🔧',
    description: autoDescription,
    weight: 0.2,
    maxValue: this.customComponent.maxValue,
    currentValue: Math.random() * this.customComponent.maxValue,
    neo4jProperty: this.customComponent.name.trim(),
    isComposite: false
  };
  
  this.availableComponents.push(newComponent);
  this.closeCustomComponentModal();
  
  console.log('Added custom component:', newComponent.name);
}

  // Network selection methods
  toggleAllNetworks(event: any) {
    const selectAll = event.target.checked;
    this.selectedNetworks = new Array(this.availableNetworks.length).fill(selectAll);
    this.selectAllNetworks = selectAll;
  }

  updateNetworkSelection() {
    const selectedCount = this.getSelectedNetworksCount();
    const totalCount = this.availableNetworks.length;
    
    if (selectedCount === 0) {
      this.selectAllNetworks = false;
    } else if (selectedCount === totalCount) {
      this.selectAllNetworks = true;
    } else {
      this.selectAllNetworks = false;
    }
  }

  isSelectAllIndeterminate(): boolean {
    const selectedCount = this.getSelectedNetworksCount();
    const totalCount = this.availableNetworks.length;
    return selectedCount > 0 && selectedCount < totalCount;
  }

  getSelectedNetworksCount(): number {
    return this.selectedNetworks.filter(selected => selected).length;
  }

  getSelectionCountText(): string {
    const count = this.getSelectedNetworksCount();
    if (count === 0) {
      return '0 networks selected';
    } else if (count === 1) {
      return '1 network selected';
    } else {
      return `${count} networks selected`;
    }
  }

  // Modal methods
  closeConfigModal() {
    this.showConfigModal = false;
  }

  closeNetworkModal() {
    this.showNetworkModal = false;
    this.selectedNetworks = new Array(this.availableNetworks.length).fill(false);
    this.selectAllNetworks = false;
  }

  closeSubnetModal() {
    this.showSubnetModal = false;
  }
  
  selectApplyOption(option: string) {
  this.closeConfigModal();
  
  switch(option) {
    case 'network':
      this.showNetworkModal = true;
      break;
    case 'subnet':
      this.showSubnetModal = true;
      break;
    case 'ip':
      this.loadIpAddresses();
      this.showIpModal = true;
      break;
    case 'sample':
      this.applyToRandomSample();
      break;
  }
}
}