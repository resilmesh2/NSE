import { Component, Input, OnInit, OnChanges, SimpleChanges, ElementRef, ViewChild, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SubnetData } from '../../models/network-data';
import { TooltipService } from '../../services/tooltip.service';
import { Router, ActivatedRoute } from '@angular/router';
import { DeviceStateService } from '../../services/device-state.service';

declare var d3: any;

@Component({
  selector: 'app-treemap',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './treemap.component.html',
  styleUrls: ['./treemap.component.css']
})
export class TreemapComponent implements OnInit, OnChanges {
  @Input() networkData: SubnetData[] = [];
  @Output() subnetClick = new EventEmitter<SubnetData>();
  @ViewChild('treemapContainer', { static: true }) treemapContainer!: ElementRef;

  sizeBy = 'devices';
  colorBy = 'threat';
  groupBy = 'organization';
  private isHoveringTreemap = false;

  currentOrgPage = 1;
  orgsPerPage = 6;
  totalOrgPages = 1;
  allOrganizationsData: any[] = [];
  selectedOrganization: any = null;
  originalNetworkData: SubnetData[] = [];
  showingAutomations = false;
  automationTreemapData: any[] = [];
  private currentAutomationGroups: any = {};
  automationGroupBy: 'targetType' | 'organization' = 'targetType';

  constructor(private tooltipService: TooltipService,
              private route: ActivatedRoute,
              private deviceStateService: DeviceStateService,
              private router: Router
  ) {}

  ngOnInit() {
  this.originalNetworkData = [...this.networkData];
  
  this.deviceStateService.selectedOrganization$.subscribe(org => {
    if (org) {
      console.log('Organization selected from service:', org);
      this.selectedOrganization = org;
      this.filterForOrganization(org.name);
    } else {
      console.log('Organization filter cleared');
      this.clearOrganizationFilter();
    }
  });
  
  this.route.queryParams.subscribe(params => {
    if (params['showAutomations'] === 'true') {
      const storedData = sessionStorage.getItem('automationTreemapData');
      if (storedData) {
        this.loadAutomationTreemapView();
      } else {
        console.log('No automation data found, showing normal treemap');
        this.showingAutomations = false;
        this.initTreemap();
      }
    } else if (params['organization'] && params['groupBy'] === 'organization') {
      console.log('Route params detected:', params);
      this.filterForOrganization(params['organization']);
    } else if (this.selectedOrganization || this.showingAutomations) {
      this.clearOrganizationFilter();
      this.showingAutomations = false;
    }
  });

  setTimeout(() => {
    if (!this.selectedOrganization && !this.showingAutomations) {
      this.initTreemap();
    }
  }, 100);
}

clearOrganizationFilter(): void {
  this.selectedOrganization = null;
  this.networkData = [...this.originalNetworkData];
  this.initTreemap();
}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['networkData'] && !changes['networkData'].firstChange) {
      this.initTreemap();
    }
  }

  onGroupByChange() {
    this.currentOrgPage = 1; // Reset pagination when switching modes
    this.initTreemap();
  }
  
private filterForOrganization(organizationName: string): void {
  console.log(`Filtering treemap for organization: ${organizationName}`);
  
  // Filter networkData to only show subnets from this organization
  this.networkData = this.originalNetworkData.filter(subnet => 
    subnet.organizationName === organizationName
  );
  
  // Force groupBy to be 'organization' but only show this one organization
  this.groupBy = 'organization';
  
  console.log(`Filtered to ${this.networkData.length} subnets for ${organizationName}`);
  
  // Add a delay to ensure data is fully processed before rendering
  setTimeout(() => {
    this.initTreemap();
  }, 100);
}

  private initTreemap() {
  if (!this.networkData || this.networkData.length === 0) {
    this.showNoDataMessage();
    return;
  }

  if (typeof d3 === 'undefined') {
    console.error('D3 not loaded');
    return;
  }

  const container = d3.select(this.treemapContainer.nativeElement);
  container.selectAll('*').remove();

  const containerElement = this.treemapContainer.nativeElement;
  const width = containerElement.clientWidth || 800;
  
  const legendHeight = 100;
  const treemapHeight = 500;
  const totalHeight = treemapHeight + legendHeight;

  const colorScale = this.createColorScale();

  this.createLegend(container, colorScale, width);

  // Properly type the groups variable
  let groups: { [key: string]: any };
  
  if (this.selectedOrganization && this.networkData.length > 0) {
    // Create a single group for the selected organization
    const orgName = this.selectedOrganization.name;
    groups = {};
    groups[orgName] = {
      name: orgName,
      children: this.networkData.map(subnet => ({
        name: subnet.subnet,
        value: Math.log(Math.max(subnet.deviceCount, 1) + 1) * 10, // Add proper value calculation
        deviceCount: subnet.deviceCount,
        threat: subnet.riskScore,
        riskLevel: subnet.riskLevel,
        isVulnerable: subnet.isVulnerable,
        originalData: subnet
      })),
      totalRisk: this.networkData.reduce((sum, subnet) => sum + subnet.riskScore, 0),
      avgRisk: this.networkData.reduce((sum, subnet) => sum + subnet.riskScore, 0) / this.networkData.length,
      totalDevices: this.networkData.reduce((sum, subnet) => sum + subnet.deviceCount, 0),
      vulnerableCount: this.networkData.filter(subnet => subnet.isVulnerable).length
    };
    
    // No pagination needed for single organization
    this.allOrganizationsData = [groups[orgName]];
    this.totalOrgPages = 1;
    this.currentOrgPage = 1;
    
    console.log('Organization treemap data prepared:', groups[orgName]);
  } else {
    // Use existing grouping logic for normal view
    groups = this.groupBy === 'subnet' ? 
      this.groupDataBySubnetRange() : 
      this.groupDataByOrganization();
  }

  // Rest of the method stays the same...
  const svg = container.append('svg')
    .attr('width', width)
    .attr('height', treemapHeight)
    .style('margin-top', '20px');

  const root = d3.hierarchy({ children: Object.values(groups) }, (d: any) => d.children)
  .sum((d: any) => d.value || d.deviceCount || 1)
  .sort((a: any, b: any) => (b.value || 0) - (a.value || 0));

  d3.treemap()
    .size([width, treemapHeight])
    .padding(1)
    .paddingTop(20)(root);

  this.drawParentRectangles(svg, root, colorScale);
  this.drawLeafRectangles(svg, root, colorScale);
}

  private groupDataByOrganization() {
    const groups: any = {};
    
    this.networkData.forEach(item => {
      const orgName = item.organizationName || 'Unknown Organization';
      
      if (!groups[orgName]) {
        groups[orgName] = {
          name: orgName,
          organizationId: item.organizationId,
          children: [],
          totalDevices: 0,
          totalRisk: 0,
          maxRisk: 0,
          vulnerableCount: 0
        };
      }

      let value;
      switch(this.sizeBy) {
        case 'subnets':
          value = Math.log(Math.max(1, item.deviceCount) + 1) * 10;
          break;
        case 'devices':
        default:
          value = Math.log(Math.max(item.deviceCount, 1) + 1) * 10;
          break;
      }
      value = Math.max(value, 5);

      groups[orgName].totalDevices += item.deviceCount;
      groups[orgName].totalRisk += item.riskScore;
      groups[orgName].maxRisk = Math.max(groups[orgName].maxRisk, item.riskScore);
      if (item.isVulnerable) groups[orgName].vulnerableCount++;

      groups[orgName].children.push({
        name: item.subnet,
        value: value,
        threat: item.riskScore,
        deviceCount: item.deviceCount,
        riskLevel: item.riskLevel,
        isVulnerable: item.isVulnerable,
        originalData: item,
        organizationName: orgName
      });
    });

    // Calculate average risk for each organization
    Object.values(groups).forEach((group: any) => {
      group.avgRisk = group.children.length > 0 ? 
        group.totalRisk / group.children.length : 0;
      group.children.sort((a: any, b: any) => b.threat - a.threat);
    });

    // Store all organizations and calculate pagination
    this.allOrganizationsData = Object.values(groups).sort((a: any, b: any) => b.avgRisk - a.avgRisk);
    this.totalOrgPages = Math.ceil(this.allOrganizationsData.length / this.orgsPerPage);
    
    // Return paginated organizations
    return this.getPaginatedOrganizations();
  }
  
  private groupDataBySubnetRange() {
  const groups: any = {};
  
  this.networkData.forEach(item => {
    const subnetParts = item.subnet.split('/')[0].split('.');
    let rangeGroup = '';
    
    if (subnetParts.length >= 2) {
      const firstOctet = parseInt(subnetParts[0]);
      const secondOctet = parseInt(subnetParts[1]);
      
      // Group by network ranges
      if (firstOctet === 10) {
        rangeGroup = `10.${secondOctet}.0.0/16`;
      } else if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) {
        rangeGroup = `172.${secondOctet}.0.0/16`;
      } else if (firstOctet === 192 && secondOctet === 168) {
        if (subnetParts.length >= 3) {
          rangeGroup = `192.168.${subnetParts[2]}.0/24`;
        } else {
          rangeGroup = `192.168.0.0/16`;
        }
      } else if (firstOctet === 147 && secondOctet === 251) {
        rangeGroup = `147.251.0.0/16`;
      } else if (firstOctet === 217 && secondOctet === 69) {
        rangeGroup = `217.69.96.0/24`;
      } else {
        if (firstOctet >= 192 && firstOctet <= 223) {
          rangeGroup = `${subnetParts[0]}.${subnetParts[1]}.${subnetParts[2] || '0'}.0/24`;
        } else {
          rangeGroup = `${subnetParts[0]}.${subnetParts[1] || '0'}.0.0/16`;
        }
      }
    } else {
      rangeGroup = 'Unknown Range';
    }
    
    if (!groups[rangeGroup]) {
      groups[rangeGroup] = {
        name: `Range: ${rangeGroup}`,
        organizationId: `range-${rangeGroup}`,
        children: [],
        totalDevices: 0,
        totalRisk: 0,
        maxRisk: 0,
        vulnerableCount: 0
      };
    }

    let value;
    switch(this.sizeBy) {
      case 'subnets':
        value = Math.log(Math.max(1, item.deviceCount) + 1) * 10;
        break;
      case 'devices':
      default:
        value = Math.log(Math.max(item.deviceCount, 1) + 1) * 10;
        break;
    }
    value = Math.max(value, 5);

    groups[rangeGroup].totalDevices += item.deviceCount;
    groups[rangeGroup].totalRisk += item.riskScore;
    groups[rangeGroup].maxRisk = Math.max(groups[rangeGroup].maxRisk, item.riskScore);
    if (item.isVulnerable) groups[rangeGroup].vulnerableCount++;

    groups[rangeGroup].children.push({
      name: item.subnet,
      value: value,
      threat: item.riskScore,
      deviceCount: item.deviceCount,
      riskLevel: item.riskLevel,
      isVulnerable: item.isVulnerable,
      originalData: item,
      subnetRange: rangeGroup
    });
  });

  // Calculate average risk
  Object.values(groups).forEach((group: any) => {
    group.avgRisk = group.children.length > 0 ? 
      group.totalRisk / group.children.length : 0;
    group.children.sort((a: any, b: any) => b.threat - a.threat);
  });

  // Store all subnet ranges and calculate pagination
  this.allOrganizationsData = Object.values(groups).sort((a: any, b: any) => b.avgRisk - a.avgRisk);
  this.totalOrgPages = Math.ceil(this.allOrganizationsData.length / this.orgsPerPage);
  
  // Return paginated subnet ranges
  return this.getPaginatedOrganizations();
}

get organizationPaginationInfo(): string {
  if (this.allOrganizationsData.length === 0) {
    return this.groupBy === 'subnet' ? 'No subnet ranges' : 'No organizations';
  }
  const startIndex = (this.currentOrgPage - 1) * this.orgsPerPage + 1;
  const endIndex = Math.min(this.currentOrgPage * this.orgsPerPage, this.allOrganizationsData.length);
  const itemType = this.groupBy === 'subnet' ? 'subnet ranges' : 'organizations';
  return `Showing ${startIndex}-${endIndex} of ${this.allOrganizationsData.length} ${itemType}`;
}

goToOrgPage(page: number) {
  if (page >= 1 && page <= this.totalOrgPages) {
    this.currentOrgPage = page;
    this.initTreemap();
  }
}

  private getPaginatedOrganizations() {
    const startIndex = (this.currentOrgPage - 1) * this.orgsPerPage;
    const endIndex = Math.min(startIndex + this.orgsPerPage, this.allOrganizationsData.length);
    
    const paginatedOrgs = this.allOrganizationsData.slice(startIndex, endIndex);
    
    // Convert back to groups object format
    const groups: any = {};
    paginatedOrgs.forEach(org => {
      groups[org.name] = org;
    });
    
    return groups;
  }

  private drawParentRectangles(svg: any, root: any, colorScale: any) {
    const parents = svg.selectAll('.parent')
      .data(root.descendants().filter((d: any) => d.depth === 1))
      .enter().append('g')
      .attr('class', 'parent');

    parents.append('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('height', (d: any) => d.y1 - d.y0)
      .attr('fill', (d: any) => {
        if (d.data.vulnerableCount > 0) return '#8B0000';
        return colorScale(d.data.avgRisk || 0);
      })
      .attr('fill-opacity', 0.3)
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseover', (event: any, d: any) => {
        d3.select(event.target).attr('stroke-width', 4).attr('stroke', '#007bff');
        this.tooltipService.showNetworkGroupTooltip(event, {
          name: d.data.name,
          children: d.data.children,
          totalDevices: d.data.totalDevices,
          avgRisk: d.data.avgRisk,
          vulnerableCount: d.data.vulnerableCount,
          organizationId: d.data.organizationId
        });
      })
      .on('mouseout', (event: any, d: any) => {
        d3.select(event.target).attr('stroke-width', 2).attr('stroke', '#fff');
        this.tooltipService.hide();
      });

    const defs = svg.append('defs');

    parents.each((d: any, i: number, nodes: any[]) => {
    const clipId = `clip-org-${i}`;
    
    defs.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', d.x0)
      .attr('y', d.y0)
      .attr('width', d.x1 - d.x0)
      .attr('height', d.y1 - d.y0);
    
    d3.select(nodes[i]).attr('clip-path', `url(#${clipId})`);
  });

    // Add text labels
    parents.filter((d: any) => this.shouldShowOrgText(d))
    .append('text')
    .attr('x', (d: any) => d.x0 + 6)
    .attr('y', (d: any) => d.y0 + this.calculateHeaderFontSize(d) + 6)
    .text((d: any) => this.truncateOrgName(d.data.name, d))
    .attr('font-size', (d: any) => this.calculateHeaderFontSize(d) + 'px')
    .attr('font-weight', 'bold')
    .attr('fill', '#2d3748')
    .style('pointer-events', 'none')
    .style('overflow', 'hidden');

    // Add stats text
    parents.filter((d: any) => this.shouldShowStatsText(d))
      .append('text')
      .attr('x', (d: any) => d.x1 - 6)
      .attr('y', (d: any) => d.y0 + this.calculateStatsFontSize(d) + 6)
      .attr('text-anchor', 'end')
      .text((d: any) => this.getStatsText(d))
      .attr('font-size', (d: any) => this.calculateStatsFontSize(d) + 'px')
      .attr('font-weight', '500')
      .attr('fill', (d: any) => d.data.vulnerableCount > 0 ? '#dc3545' : '#64748b')
      .style('pointer-events', 'none')
      .style('overflow', 'hidden');
  }

  private drawLeafRectangles(svg: any, root: any, colorScale: any) {
    const leaves = svg.selectAll('.leaf')
      .data(root.leaves())
      .enter().append('g')
      .attr('class', 'leaf');

    leaves.append('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('height', (d: any) => d.y1 - d.y0)
      .attr('fill', (d: any) => {
        if (d.data.isVulnerable) return '#8B0000';
        return colorScale(d.data.threat || 0);
      })
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mouseover', (event: any, d: any) => {
        d3.select(event.target).attr('stroke-width', 3).attr('stroke', '#007bff');
        
        this.tooltipService.showSubnetTooltip(event, {
          subnet: d.data.name,
          deviceCount: d.data.deviceCount,
          riskScore: d.data.threat,
          riskLevel: d.data.riskLevel,
          isVulnerable: d.data.isVulnerable,
          networkSize: 24
        });
      })
      .on('mouseout', (event: any, d: any) => {
        d3.select(event.target).attr('stroke-width', 1).attr('stroke', 'white');
        this.tooltipService.hide();
      })
      .on('click', (event: any, d: any) => {
        this.tooltipService.hide();
        if (d.data.originalData) {
          console.log(`Treemap clicked - subnet: ${d.data.originalData.subnet}`);
          this.subnetClick.emit(d.data.originalData);
        }
      });

    // Add subnet labels
    leaves.append('text')
      .attr('x', (d: any) => d.x0 + 3)
      .attr('y', (d: any) => d.y0 + this.calculateSubnetLabelFontSize(d) + 3)
      .text((d: any) => {
        const width = d.x1 - d.x0;
        const height = d.y1 - d.y0;
        const fontSize = this.calculateSubnetLabelFontSize(d);
        
        if (width > 40 && height > 12) {
          const parts = d.data.name.split('.');
          const subnet = parts.length >= 3 ? `${parts[2]}.${parts[3]}` : d.data.name;
          const maxChars = Math.floor(width / (fontSize * 0.4));
          return subnet.length <= maxChars ? subnet : subnet.substring(0, maxChars - 1);
        }
        return '';
      })
      .attr('font-size', (d: any) => this.calculateSubnetLabelFontSize(d) + 'px')
      .attr('font-weight', '600')
      .attr('fill', 'black')
      .style('pointer-events', 'none');

    // Add device count labels
    leaves.append('text')
      .attr('x', (d: any) => d.x0 + 3)
      .attr('y', (d: any) => d.y0 + this.calculateSubnetLabelFontSize(d) + this.calculateDeviceCountFontSize(d) + 6)
      .text((d: any) => {
        const width = d.x1 - d.x0;
        const height = d.y1 - d.y0;
        if (width > 60 && height > 20) {
          return `${d.data.deviceCount} devices`;
        } else if (width > 35 && height > 15) {
          return `${d.data.deviceCount}`;
        }
        return '';
      })
      .attr('font-size', (d: any) => this.calculateDeviceCountFontSize(d) + 'px')
      .attr('fill', 'black') // Changed to white
      .attr('font-weight', '500')
      .attr('opacity', 0.95) // Slightly more opaque
      .style('pointer-events', 'none');

    // Add vulnerability indicators
    leaves.filter((d: any) => d.data.isVulnerable)
      .append('text')
      .attr('x', (d: any) => d.x1 - 3)
      .attr('y', (d: any) => d.y0 + 12)
      .attr('text-anchor', 'end')
      .text('⚠')
      .attr('font-size', '12px')
      .attr('fill', '#fff')
      .style('pointer-events', 'none')
      .style('text-shadow', '1px 1px 2px rgba(0,0,0,0.8)');
  }

  private shouldShowOrgText(d: any): boolean {
    const width = d.x1 - d.x0;
    const height = d.y1 - d.y0;
    return width > 80 && height > 25;
  }

  private shouldShowStatsText(d: any): boolean {
    const width = d.x1 - d.x0;
    const height = d.y1 - d.y0;
    return width > 120 && height > 35;
  }

  private calculateHeaderFontSize(d: any): number {
    const width = d.x1 - d.x0;
    const height = d.y1 - d.y0;
    let fontSize = Math.min(width / 20, height / 10, 14);
    fontSize = Math.max(fontSize, 8);
    return Math.floor(fontSize);
  }

  private calculateStatsFontSize(d: any): number {
    const width = d.x1 - d.x0;
    const height = d.y1 - d.y0;
    let fontSize = Math.min(width / 25, height / 15, 10);
    fontSize = Math.max(fontSize, 6);
    return Math.floor(fontSize);
  }

  private truncateOrgName(name: string, d: any): string {
    const width = d.x1 - d.x0;
    const fontSize = this.calculateHeaderFontSize(d);
    const maxChars = Math.floor((width - 12) / (fontSize * 0.5));
    
    if (maxChars < 4) return '';
    if (name.length <= maxChars) {
      return name;
    }
    return name.substring(0, maxChars - 3) + '...';
  }

  private calculateSubnetLabelFontSize(d: any): number {
    const width = d.x1 - d.x0;
    const height = d.y1 - d.y0;
    // Increased minimum font size and made scaling more aggressive
    let fontSize = Math.min(width / 6, height / 2.5, 14); // Changed from width/8, height/3
    fontSize = Math.max(fontSize, 8); // Increased minimum from 6 to 8
    return Math.floor(fontSize);
  }

  private calculateDeviceCountFontSize(d: any): number {
    const width = d.x1 - d.x0;
    const height = d.y1 - d.y0;
    // Made device count text more readable
    let fontSize = Math.min(width / 8, height / 3.5, 11); // Changed from width/12, height/4
    fontSize = Math.max(fontSize, 7); // Increased minimum from 5 to 7
    return Math.floor(fontSize);
  }

  private getStatsText(d: any): string {
    const width = d.x1 - d.x0;
    const avgRisk = d.data.avgRisk || 0;
    const vulnText = d.data.vulnerableCount > 0 ? ` ⚠${d.data.vulnerableCount}` : '';
    
    if (width > 200) {
      return `${d.data.children.length} subnets | Risk: ${avgRisk.toFixed(1)}${vulnText}`;
    } else if (width > 120) {
      return `${d.data.children.length} nets | ${avgRisk.toFixed(1)}${vulnText}`;
    } else if (width > 80) {
      return `${d.data.children.length} | ${avgRisk.toFixed(1)}`;
    } else {
      return `${avgRisk.toFixed(1)}`;
    }
  }

  private createColorScale() {
    switch(this.colorBy) {
      case 'activity':
        return d3.scaleSequential(d3.interpolatePurples).domain([0, 10]);
      case 'threat':
      default:
        return d3.scaleLinear()
          .domain([0, 2, 4, 6, 8, 10])
          .range(['#28a745', '#20c997', '#ffc107', '#fd7e14', '#dc3545', '#8B0000']);
    }
  }

  private createLegend(container: any, colorScale: any, width: number) {
    container.selectAll('.legend-container').remove();
    
    const legendContainer = container.append('div')
      .attr('class', 'legend-container')
      .style('margin', '15px 0')
      .style('text-align', 'center')
      .style('padding', '15px')
      .style('width', '100%')
      .style('overflow', 'visible')
      .style('box-sizing', 'border-box');

    legendContainer.append('div')
      .style('font-size', '12px')
      .style('font-weight', 'bold')
      .style('color', '#333')
      .style('margin-bottom', '10px')
      .text('Risk Score');

    const colorBar = legendContainer.append('div')
      .style('width', '300px')
      .style('height', '15px')
      .style('margin', '0 auto 10px auto')
      .style('background', 'linear-gradient(to right, #28a745, #20c997, #ffc107, #fd7e14, #dc3545, #8B0000)')
      .style('border', '1px solid #999')
      .style('border-radius', '2px');

    const scaleContainer = legendContainer.append('div')
      .style('display', 'flex')
      .style('justify-content', 'space-between')
      .style('width', '300px')
      .style('margin', '0 auto 15px auto')
      .style('font-size', '10px')
      .style('color', '#666');

    [0, 2, 4, 6, 8, 10].forEach(value => {
      scaleContainer.append('span').text(value.toString());
    });

    legendContainer.append('div')
      .style('font-size', '11px')
      .style('color', '#666')
      .style('max-width', '600px')
      .style('margin', '0 auto')
      .style('line-height', '1.4')
      .text(`Red Nodes indicate High-Risk subnets | Grouped by ${this.groupBy === 'subnet' ? 'Subnet Range' : 'Organization'} | Hover for details | Click to explore devices`);
  }

  private showNoDataMessage() {
    const container = d3.select(this.treemapContainer.nativeElement);
    container.selectAll('*').remove();
    
    container.append('div')
      .style('text-align', 'center')
      .style('padding', '40px')
      .style('color', '#666')
      .style('font-size', '18px')
      .text('No data available. Load network data first.');
  }

  nextOrgPage() {
    this.goToOrgPage(this.currentOrgPage + 1);
  }

  prevOrgPage() {
    this.goToOrgPage(this.currentOrgPage - 1);
  }

  getOrgPageNumbers(): number[] {
    const maxVisible = 5;
    let start = Math.max(1, this.currentOrgPage - Math.floor(maxVisible / 2));
    let end = Math.min(this.totalOrgPages, start + maxVisible - 1);
    
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    
    const pages = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }
  
  private loadAutomationTreemapView(): void {
  const storedData = sessionStorage.getItem('automationTreemapData');
  
  if (!storedData) {
    console.error('No automation data found');
    return;
  }
  
  this.automationTreemapData = JSON.parse(storedData);
  this.showingAutomations = true;
  
  console.log('Loaded automation data for treemap:', this.automationTreemapData);
  
  this.prepareAutomationTreemapData();
}

private prepareAutomationTreemapData(): void {
  let automationGroups: any = {};
  
  if (this.automationGroupBy === 'organization') {
    automationGroups = this.groupAutomationsByOrganization();
  } else {
    automationGroups = this.groupAutomationsByTargetType();
  }
  
  Object.values(automationGroups).forEach((group: any) => {
    if (group.affectedTargets instanceof Set) {
      group.affectedTargets = group.affectedTargets.size;
    }
  });
  
  this.currentAutomationGroups = automationGroups;
  this.renderAutomationTreemap(automationGroups);
}

private groupAutomationsByTargetType(): any {
  const groups: any = {};
  
  this.automationTreemapData.forEach(automation => {
    const groupKey = automation.targetType || 'unknown';
    
    if (!groups[groupKey]) {
      groups[groupKey] = {
        name: this.formatTargetTypeName(groupKey),
        children: [],
        totalAutomations: 0,
        affectedTargets: new Set()
      };
    }
    
    groups[groupKey].children.push({
      name: automation.name,
      value: 10,
      automation: automation,
      enabled: automation.enabled,
      expanded: false
    });
    
    automation.targetValues.forEach((targetValue: string) => {
      groups[groupKey].affectedTargets.add(targetValue);
    });
    
    groups[groupKey].totalAutomations++;
  });
  
  return groups;
}

private groupAutomationsByOrganization(): any {
  const groups: any = {};
  
  this.automationTreemapData.forEach(automation => {
    const organizations = this.getOrganizationsForTargets(
      automation.targetValues, 
      automation.targetType
    );
    
    organizations.forEach(orgName => {
      if (!groups[orgName]) {
        groups[orgName] = {
          name: orgName,
          children: [],
          totalAutomations: 0,
          affectedTargets: new Set()
        };
      }
      
      const existingAutomation = groups[orgName].children.find(
        (child: any) => child.automation.id === automation.id
      );
      
      if (!existingAutomation) {
        groups[orgName].children.push({
          name: automation.name,
          value: 10,
          automation: automation,
          enabled: automation.enabled,
          expanded: false
        });
        
        groups[orgName].totalAutomations++;
      }
      
      automation.targetValues.forEach((targetValue: string) => {
        groups[orgName].affectedTargets.add(targetValue);
      });
    });
  });
  
  return groups;
}

private getOrganizationsForTargets(targets: string[], targetType: string): string[] {
  const organizations = new Set<string>();
  
  targets.forEach(target => {
    let orgName = 'Unknown Organization';
    
    if (targetType === 'network') {
      const matchingSubnets = this.originalNetworkData.filter(subnet => 
        subnet.subnet.startsWith(target)
      );
      matchingSubnets.forEach(subnet => {
        if (subnet.organizationName) {
          organizations.add(subnet.organizationName);
        }
      });
    } else if (targetType === 'subnet') {
      const matchingSubnet = this.originalNetworkData.find(subnet => 
        subnet.subnet === target
      );
      if (matchingSubnet?.organizationName) {
        organizations.add(matchingSubnet.organizationName);
      }
    } else if (targetType === 'ip') {
      const matchingSubnets = this.originalNetworkData.filter(subnet => {
        const subnetPrefix = subnet.subnet.split('/')[0].split('.').slice(0, 3).join('.');
        const ipPrefix = target.split('.').slice(0, 3).join('.');
        return subnetPrefix === ipPrefix;
      });
      matchingSubnets.forEach(subnet => {
        if (subnet.organizationName) {
          organizations.add(subnet.organizationName);
        }
      });
    }
  });
  
  return organizations.size > 0 ? Array.from(organizations) : ['Unknown Organization'];
}

private formatTargetTypeName(targetType: string): string {
  const typeMap: { [key: string]: string } = {
    'subnet': 'Subnets',
    'ip': 'IP Addresses',
    'network': 'Networks',
    'all': 'All Nodes'
  };
  return typeMap[targetType] || targetType;
}

private renderAutomationTreemap(groups: any): void {
  if (typeof d3 === 'undefined') {
    console.error('D3 not loaded');
    return;
  }

  const container = d3.select(this.treemapContainer.nativeElement);
  container.selectAll('*').remove();

  const containerElement = this.treemapContainer.nativeElement;
  const width = containerElement.clientWidth || 800;
  const treemapHeight = 500;

  // Add description and grouping toggle
  const controlsDiv = container.append('div')
    .style('margin', '15px 0')
    .style('display', 'flex')
    .style('justify-content', 'space-between')
    .style('align-items', 'center');

  controlsDiv.append('div')
    .style('font-size', '12px')
    .style('color', '#666')
    .text('Active automations - Each card represents an automation and its affected targets');

  const groupByDiv = controlsDiv.append('div')
    .style('display', 'flex')
    .style('gap', '8px')
    .style('align-items', 'center');

  groupByDiv.append('span')
    .style('font-size', '12px')
    .style('color', '#666')
    .style('font-weight', '600')
    .text('Group by:');

  const buttonGroup = groupByDiv.append('div')
    .style('display', 'flex')
    .style('gap', '4px');

  buttonGroup.append('button')
    .text('Target Type')
    .style('padding', '4px 12px')
    .style('font-size', '11px')
    .style('border', this.automationGroupBy === 'targetType' ? '2px solid #3498db' : '1px solid #ddd')
    .style('background', this.automationGroupBy === 'targetType' ? '#ebf5fb' : 'white')
    .style('color', this.automationGroupBy === 'targetType' ? '#2980b9' : '#666')
    .style('border-radius', '4px')
    .style('cursor', 'pointer')
    .style('font-weight', this.automationGroupBy === 'targetType' ? '600' : '400')
    .on('click', () => {
      this.automationGroupBy = 'targetType';
      this.prepareAutomationTreemapData();
    });

  buttonGroup.append('button')
    .text('Organization')
    .style('padding', '4px 12px')
    .style('font-size', '11px')
    .style('border', this.automationGroupBy === 'organization' ? '2px solid #3498db' : '1px solid #ddd')
    .style('background', this.automationGroupBy === 'organization' ? '#ebf5fb' : 'white')
    .style('color', this.automationGroupBy === 'organization' ? '#2980b9' : '#666')
    .style('border-radius', '4px')
    .style('cursor', 'pointer')
    .style('font-weight', this.automationGroupBy === 'organization' ? '600' : '400')
    .on('click', () => {
      this.automationGroupBy = 'organization';
      this.prepareAutomationTreemapData();
    });

  const svg = container.append('svg')
    .attr('width', width)
    .attr('height', treemapHeight)
    .style('margin-top', '20px');

  const root = d3.hierarchy({ children: Object.values(groups) })
    .sum((d: any) => d.value || 0)
    .sort((a: any, b: any) => (b.value || 0) - (a.value || 0));

  d3.treemap()
    .size([width, treemapHeight])
    .padding(3)
    .paddingTop(28)
    (root);

  const parents = svg.selectAll('.parent-group')
    .data(root.descendants().filter((d: any) => d.depth === 1))
    .enter().append('g')
    .attr('class', 'parent-group');

  parents.append('rect')
    .attr('x', (d: any) => d.x0)
    .attr('y', (d: any) => d.y0)
    .attr('width', (d: any) => d.x1 - d.x0)
    .attr('height', (d: any) => d.y1 - d.y0)
    .attr('fill', '#2c3e50')
    .attr('fill-opacity', 0.1)
    .attr('stroke', '#34495e')
    .attr('stroke-width', 2)
    .attr('rx', 4);

  parents.append('text')
  .attr('x', (d: any) => d.x0 + 10)
  .attr('y', (d: any) => d.y0 + 18)
  .text((d: any) => {
    const groupType = this.automationGroupBy === 'organization' ? 'organization' : 'target type';
    return `${d.data.name} (${d.data.totalAutomations} automations affecting ${d.data.affectedTargets} targets)`;
  })
  .attr('font-size', '12px')
  .attr('font-weight', 'bold')
  .attr('fill', '#2c3e50')
  .style('pointer-events', 'none');

  const cells = svg.selectAll('.automation-cell')
    .data(root.leaves())
    .enter().append('g')
    .attr('class', 'automation-cell');

  cells.append('rect')
    .attr('x', (d: any) => d.x0)
    .attr('y', (d: any) => d.y0)
    .attr('width', (d: any) => d.x1 - d.x0)
    .attr('height', (d: any) => d.y1 - d.y0)
    .attr('fill', '#2c3e50')
    .attr('stroke', '#fff')
    .attr('stroke-width', 2)
    .attr('rx', 6)
    .style('cursor', 'pointer')
    .on('mouseover', (event: any, d: any) => {
      d3.select(event.target)
        .attr('stroke', '#3498db')
        .attr('stroke-width', 3);
      this.showAutomationTooltip(event, d.data);
    })
    .on('mouseout', (event: any) => {
      d3.select(event.target)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);
      this.tooltipService.hide();
    });

  cells.append('line')
    .attr('x1', (d: any) => d.x0 + 8)
    .attr('y1', (d: any) => d.y0 + 32)
    .attr('x2', (d: any) => d.x1 - 8)
    .attr('y2', (d: any) => d.y0 + 32)
    .attr('stroke', 'rgba(255,255,255,0.2)')
    .attr('stroke-width', 1);

  cells.append('text')
    .attr('x', (d: any) => d.x0 + 10)
    .attr('y', (d: any) => d.y0 + 20)
    .text((d: any) => {
      const width = d.x1 - d.x0;
      const name = d.data.name;
      if (width < 120) return name.substring(0, 15) + '...';
      if (width < 180) return name.substring(0, 22) + (name.length > 22 ? '...' : '');
      return name;
    })
    .attr('font-size', '12px')
    .attr('font-weight', '600')
    .attr('fill', '#fff')
    .style('pointer-events', 'none');

  cells.append('circle')
    .attr('cx', (d: any) => d.x1 - 15)
    .attr('cy', (d: any) => d.y0 + 16)
    .attr('r', 4)
    .attr('fill', (d: any) => d.data.enabled ? '#2ecc71' : '#95a5a6')
    .style('pointer-events', 'none');

  cells.each((d: any, i: number, nodes: any[]) => {
  const cell = d3.select(nodes[i]);
  const width = d.x1 - d.x0;
  const height = d.y1 - d.y0;
  const targetCount = d.data.automation.targetValues.length;
  
  const startY = d.y0 + 45;
  const maxHeight = height - 60;
  
  if (targetCount === 1) {
    cell.append('rect')
      .attr('x', d.x0 + 8)
      .attr('y', startY)
      .attr('width', width - 16)
      .attr('height', 24)
      .attr('fill', 'rgba(255,255,255,0.1)')
      .attr('rx', 3);
    
    cell.append('text')
      .attr('x', d.x0 + 12)
      .attr('y', startY + 16)
      .text(d.data.automation.targetValues[0])
      .attr('font-size', '10px')
      .attr('fill', '#fff')
      .attr('font-family', 'monospace')
      .style('pointer-events', 'none');
  } else if (targetCount === 2 && maxHeight >= 60) {
    d.data.automation.targetValues.forEach((target: string, i: number) => {
      cell.append('rect')
        .attr('x', d.x0 + 8)
        .attr('y', startY + (i * 28))
        .attr('width', width - 16)
        .attr('height', 24)
        .attr('fill', 'rgba(255,255,255,0.08)')
        .attr('rx', 3);
      
      cell.append('text')
        .attr('x', d.x0 + 12)
        .attr('y', startY + (i * 28) + 16)
        .text(target.length > 25 ? target.substring(0, 22) + '...' : target)
        .attr('font-size', '9px')
        .attr('fill', '#fff')
        .attr('font-family', 'monospace')
        .style('pointer-events', 'none');
    });
  } else {
    cell.append('text')
      .attr('x', d.x0 + 10)
      .attr('y', startY + 10)
      .text(`${targetCount} targets`)
      .attr('font-size', '10px')
      .attr('fill', '#fff')
      .attr('opacity', 0.9)
      .style('pointer-events', 'none');
    
    const targetsToShow = d.data.expanded ? targetCount : Math.min(2, targetCount);
    const maxTargetsInView = Math.floor((height - 80) / 22);
    const actualTargetsToShow = Math.min(targetsToShow, maxTargetsInView);
    
    for (let i = 0; i < actualTargetsToShow; i++) {
      const yPos = startY + 20 + (i * 22);
      
      cell.append('rect')
        .attr('x', d.x0 + 8)
        .attr('y', yPos)
        .attr('width', width - 16)
        .attr('height', 20)
        .attr('fill', 'rgba(255,255,255,0.08)')
        .attr('rx', 3);
      
      cell.append('text')
        .attr('x', d.x0 + 12)
        .attr('y', yPos + 14)
        .text(d.data.automation.targetValues[i].length > 25 ? 
              d.data.automation.targetValues[i].substring(0, 22) + '...' : 
              d.data.automation.targetValues[i])
        .attr('font-size', '9px')
        .attr('fill', '#fff')
        .attr('font-family', 'monospace')
        .style('pointer-events', 'none');
    }
    
    if (!d.data.expanded && targetCount > 2) {
      const expandButton = cell.append('g')
        .attr('class', 'expand-button')
        .style('cursor', 'pointer')
        .on('click', (event: any) => {
          event.stopPropagation();
          d.data.expanded = true;
          this.renderAutomationTreemap(this.prepareGroupsForRender());
        });
      
      expandButton.append('rect')
        .attr('x', d.x0 + 8)
        .attr('y', startY + 68)
        .attr('width', width - 16)
        .attr('height', 20)
        .attr('fill', 'rgba(52, 152, 219, 0.3)')
        .attr('rx', 3)
        .attr('stroke', 'rgba(52, 152, 219, 0.6)')
        .attr('stroke-width', 1);
      
      expandButton.append('text')
        .attr('x', d.x0 + (width / 2))
        .attr('y', startY + 81)
        .attr('text-anchor', 'middle')
        .text(`Show ${targetCount - 2} more`)
        .attr('font-size', '9px')
        .attr('fill', '#3498db')
        .attr('font-weight', '500');
    } else if (d.data.expanded && actualTargetsToShow < targetCount) {
      const collapseButton = cell.append('g')
        .attr('class', 'collapse-button')
        .style('cursor', 'pointer')
        .on('click', (event: any) => {
          event.stopPropagation();
          d.data.expanded = false;
          this.renderAutomationTreemap(this.prepareGroupsForRender());
        });
      
      collapseButton.append('rect')
        .attr('x', d.x0 + 8)
        .attr('y', d.y1 - 44)
        .attr('width', width - 16)
        .attr('height', 20)
        .attr('fill', 'rgba(52, 152, 219, 0.3)')
        .attr('rx', 3)
        .attr('stroke', 'rgba(52, 152, 219, 0.6)')
        .attr('stroke-width', 1);
      
      collapseButton.append('text')
        .attr('x', d.x0 + (width / 2))
        .attr('y', d.y1 - 31)
        .attr('text-anchor', 'middle')
        .text('Show less')
        .attr('font-size', '9px')
        .attr('fill', '#3498db')
        .attr('font-weight', '500');
    }
  }
  
  cell.append('line')
    .attr('x1', d.x0 + 8)
    .attr('y1', d.y1 - 24)
    .attr('x2', d.x1 - 8)
    .attr('y2', d.y1 - 24)
    .attr('stroke', 'rgba(255,255,255,0.2)')
    .attr('stroke-width', 1);
  
  cell.append('text')
    .attr('x', d.x0 + 10)
    .attr('y', d.y1 - 10)
    .text(d.data.automation.targetType.toUpperCase())
    .attr('font-size', '8px')
    .attr('fill', '#fff')
    .attr('opacity', 0.7)
    .attr('text-transform', 'uppercase')
    .style('pointer-events', 'none');
});
}

private prepareGroupsForRender(): any {
  return this.currentAutomationGroups;
}

private showAutomationTooltip(event: any, data: any): void {
  const statusClass = data.enabled ? 'status-active' : 'status-paused';
  const statusText = data.enabled ? 'Active' : 'Paused';
  const targetCount = data.automation.targetValues.length;
  
  const tooltipContent = `
    <div class="tooltip-content">
      <div class="tooltip-title">${data.automation.name}</div>
      <div class="tooltip-body">
        <div class="tooltip-grid">
          <span>Status:</span>
          <span class="${statusClass}">${statusText}</span>
          <span>Target Type:</span>
          <span>${data.automation.targetType}</span>
          <span>Targets:</span>
          <span>${targetCount} ${targetCount === 1 ? 'target' : 'targets'}</span>
        </div>
        ${targetCount <= 3 ? `
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">
            <div style="font-size: 10px; opacity: 0.8; margin-bottom: 4px;">Affecting:</div>
            ${data.automation.targetValues.map((t: string) => `
              <div style="font-family: monospace; font-size: 10px; margin: 2px 0;">${t}</div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `;
  
  this.tooltipService.show(event, tooltipContent);
}

private getRiskClass(riskScore: number): string {
  if (riskScore >= 8.0) return 'critical';
  if (riskScore >= 6.0) return 'high';
  if (riskScore >= 4.0) return 'medium';
  return 'low';
}

clearAutomationView(): void {
  this.showingAutomations = false;
  this.automationTreemapData = [];
  sessionStorage.removeItem('automationTreemapData');
  
  this.router.navigate(['/'], {
    queryParams: { view: 'treemap' }
  });
  
  setTimeout(() => {
    this.initTreemap();
  }, 100);
}

}