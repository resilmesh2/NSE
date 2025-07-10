import { Component, Input, OnInit, OnChanges, SimpleChanges, ElementRef, ViewChild, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SubnetData } from '../../models/network-data';
import { TooltipService } from '../../services/tooltip.service';

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
  private isHoveringTreemap = false;

constructor(private tooltipService: TooltipService) {}

  ngOnInit() {
    setTimeout(() => {
      this.initTreemap();
    }, 100);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['networkData'] && !changes['networkData'].firstChange) {
      this.initTreemap();
    }
  }

  onSizeByChange() {
    this.initTreemap();
  }

  onColorByChange() {
    this.initTreemap();
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
  const height = containerElement.clientHeight || 500;

  // Create color scales
  const colorScale = this.createColorScale();
  const parentColorScale = this.createColorScale();

  // Create legend
  this.createLegend(container, colorScale, width);

  // Group data by network (first two octets)
  const groups = this.groupDataByNetwork();
  const sortedGroups = Object.values(groups).sort((a: any, b: any) => b.avgRisk - a.avgRisk);

  // Create hierarchy
  const root = d3.hierarchy({ children: sortedGroups })
    .sum((d: any) => d.value || 0)
    .sort((a: any, b: any) => {
      if (a.depth === 1 && b.depth === 1) {
        return b.data.avgRisk - a.data.avgRisk;
      }
      if (a.depth === 2 && b.depth === 2) {
        return b.data.threat - a.data.threat;
      }
      const aRisk = a.data.threat || a.data.avgRisk || 0;
      const bRisk = b.data.threat || b.data.avgRisk || 0;
      return bRisk - aRisk;
    });

  // Create treemap layout
  const treemap = d3.treemap()
    .size([width, height])
    .paddingInner(4)
    .paddingOuter(4)
    .paddingTop((d: any) => d.depth === 1 ? 25 : 4)
    .round(true);

  treemap(root);

  const svg = container.append('svg')
    .attr('width', width)
    .attr('height', height);

  // Draw parent rectangles (network groups)
  this.drawParentRectangles(svg, root, parentColorScale);

  // Draw leaf rectangles (individual subnets)
  this.drawLeafRectangles(svg, root, colorScale);
}

  private groupDataByNetwork() {
    const groups: any = {};
    
    this.networkData.forEach(item => {
      const network = item.subnet.split('.').slice(0, 2).join('.');
      if (!groups[network]) {
        groups[network] = {
          name: network,
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
          value = 1;
          break;
        case 'devices':
        default:
          value = Math.max(item.deviceCount, 1);
          break;
      }

      groups[network].totalDevices += item.deviceCount;
      groups[network].totalRisk += item.riskScore;
      groups[network].maxRisk = Math.max(groups[network].maxRisk, item.riskScore);
      if (item.isVulnerable) groups[network].vulnerableCount++;

      groups[network].children.push({
        name: item.subnet,
        value: value,
        threat: item.riskScore,
        deviceCount: item.deviceCount,
        riskLevel: item.riskLevel,
        isVulnerable: item.isVulnerable,
        originalData: item
      });
    });

    // Calculate average risk for each group
    Object.values(groups).forEach((group: any) => {
      group.avgRisk = group.children.length > 0 ? group.totalRisk / group.children.length : 0;
      group.children.sort((a: any, b: any) => b.threat - a.threat);
    });

    return groups;
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
        this.tooltipService.showNetworkGroupTooltip(event, d.data);
      })
      .on('mouseout', (event: any, d: any) => {
        d3.select(event.target).attr('stroke-width', 2).attr('stroke', '#fff');
        this.tooltipService.hide();
      });

    // Add parent labels
    parents.append('text')
      .attr('x', (d: any) => d.x0 + 6)
      .attr('y', (d: any) => d.y0 + 18)
      .text((d: any) => `${d.data.name}.x network`)
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .attr('fill', '#2d3748')
      .style('pointer-events', 'none');

    // Add network statistics
    parents.append('text')
      .attr('x', (d: any) => d.x1 - 6)
      .attr('y', (d: any) => d.y0 + 18)
      .attr('text-anchor', 'end')
      .text((d: any) => {
        const avgRisk = d.data.avgRisk || 0;
        const vulnText = d.data.vulnerableCount > 0 ? ` ⚠${d.data.vulnerableCount}` : '';
        return `${d.data.children.length} subnets | Risk: ${avgRisk.toFixed(1)}${vulnText}`;
      })
      .attr('font-size', '10px')
      .attr('font-weight', '500')
      .attr('fill', (d: any) => d.data.vulnerableCount > 0 ? '#dc3545' : '#64748b')
      .style('pointer-events', 'none');
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
      .attr('y', (d: any) => d.y0 + 12)
      .text((d: any) => {
        const width = d.x1 - d.x0;
        const height = d.y1 - d.y0;
        if (width > 60 && height > 15) {
          const parts = d.data.name.split('.');
          return parts.length >= 3 ? `${parts[2]}.${parts[3]}` : d.data.name;
        }
        return '';
      })
      .attr('font-size', '9px')
      .attr('font-weight', '500')
      .attr('fill', 'black')
      .style('pointer-events', 'none');

    // Add device count labels
    leaves.append('text')
      .attr('x', (d: any) => d.x0 + 3)
      .attr('y', (d: any) => d.y0 + 24)
      .text((d: any) => {
        const width = d.x1 - d.x0;
        const height = d.y1 - d.y0;
        if (width > 80 && height > 25) {
          return `${d.data.deviceCount} devices`;
        }
        return '';
      })
      .attr('font-size', '8px')
      .attr('fill', 'black')
      .attr('opacity', 0.9)
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

  private createLegend(container: any, colorScale: any, width: number) {
  // Remove any existing legend
  container.selectAll('.legend-container').remove();
  
  // Create HTML legend instead of SVG
  const legendContainer = container.append('div')
    .attr('class', 'legend-container')
    .style('margin', '15px 0')
    .style('text-align', 'center')
    .style('padding', '15px')
    .style('width', '100%')
    .style('overflow', 'visible')
    .style('box-sizing', 'border-box');

  // Add title
  legendContainer.append('div')
    .style('font-size', '12px')
    .style('font-weight', 'bold')
    .style('color', '#333')
    .style('margin-bottom', '10px')
    .text('Risk Score');

  // Create color bar with CSS gradient
  const colorBar = legendContainer.append('div')
    .style('width', '300px')
    .style('height', '15px')
    .style('margin', '0 auto 10px auto')
    .style('background', 'linear-gradient(to right, #28a745, #20c997, #ffc107, #fd7e14, #dc3545, #8B0000)')
    .style('border', '1px solid #999')
    .style('border-radius', '2px');

  // Add scale labels
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

  // Add instruction text
  legendContainer.append('div')
    .style('font-size', '11px')
    .style('color', '#666')
    .style('max-width', '600px')
    .style('margin', '0 auto')
    .style('line-height', '1.4')
    .text('Red Nodes indicate High-Risk subnets | Hover for details | Click to explore devices');
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
}