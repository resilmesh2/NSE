import { Component, Input, OnInit, OnChanges, SimpleChanges, ElementRef, ViewChild, Output, EventEmitter, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SubnetData } from '../../models/network-data';
import { TooltipService } from '../../services/tooltip.service';

declare var d3: any;

@Component({
  selector: 'app-network-graph',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './network-graph.component.html',
  styleUrls: ['./network-graph.component.css']
})
export class NetworkGraphComponent implements OnInit, OnChanges, AfterViewInit {
  @Input() networkData: SubnetData[] = [];
  @Output() subnetClick = new EventEmitter<SubnetData>();
  @ViewChild('graphContainer', { static: true }) graphContainer!: ElementRef;
  @ViewChild('legendContainer', { static: true }) legendContainer!: ElementRef;

  searchTerm = '';
  simulation: any = null;
  svg: any = null;
  g: any = null;
  nodes: any[] = [];
  links: any[] = [];

  constructor(private tooltipService: TooltipService) {}

  ngOnInit() {
  console.log('NetworkGraphComponent initialized');
  
  // Add window resize listener for responsive legend
  window.addEventListener('resize', () => {
    if (this.networkData && this.networkData.length > 0) {
      setTimeout(() => {
        const container = this.graphContainer.nativeElement;
        const containerWidth = container.clientWidth || 800;
        this.createLegend(containerWidth);
      }, 100);
    }
  });
}

  ngAfterViewInit() {
  // Increased delay to ensure data loading completes
  setTimeout(() => {
    this.initGraph();
  }, 200);
}

ngOnChanges(changes: SimpleChanges) {
  if (changes['networkData']) {
    if (!changes['networkData'].firstChange) {
      console.log('Network data changed, reinitializing graph with updated risk scores');
      // Log a few subnet risk scores to verify data
      if (this.networkData && this.networkData.length > 0) {
        console.log('Sample risk scores:', this.networkData.slice(0, 3).map(s => `${s.subnet}: ${s.riskScore.toFixed(1)}`));
      }
    }
    setTimeout(() => {
      this.initGraph();
    }, 50);
  }
}

  initGraph() {
    if (!this.networkData || this.networkData.length === 0) {
      console.log('No network data available for graph');
      return;
    }

    if (typeof d3 === 'undefined') {
      console.error('D3 not loaded');
      return;
    }

    // Clear any existing content
    const container = this.graphContainer.nativeElement;
    d3.select(container).selectAll('*').remove();

    // Set up dimensions
    const containerWidth = container.clientWidth || 800;
    const containerHeight = container.clientHeight || 500;

    // Create legend
    this.createLegend(containerWidth);

    // Transform network data to D3 format
    const { nodes, links } = this.transformNetworkDataForD3();
    this.nodes = nodes;
    this.links = links;

    // Create size scale for device count
    const sizeScale = d3.scaleLinear()
      .domain(d3.extent(nodes, (d: any) => d.deviceCount))
      .range([8, 25]);

    // Create color scale
    const colorScale = d3.scaleLinear()
      .domain([0, 2, 4, 6, 8, 10])
      .range(['#00e676', '#4caf50', '#ffeb3b', '#ff9800', '#ff5722', '#ff0000']);

    // Create the force simulation
    this.simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(containerWidth / 2, containerHeight / 2))
      .force("collision", d3.forceCollide().radius((d: any) => sizeScale(d.deviceCount) + 2));

    // Create SVG
    this.svg = d3.select(container)
      .append('svg')
      .attr('width', containerWidth)
      .attr('height', containerHeight)
      .attr('viewBox', [0, 0, containerWidth, containerHeight])
      .style('max-width', '100%')
      .style('height', 'auto')
      .style('border', '1px solid #dee2e6')
      .style('border-radius', '8px')
      .style('background', '#fafafa');

    this.g = this.svg.append('g');

    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event: any) => {
        this.g.attr('transform', event.transform);
      });

    this.svg.call(zoom);

    // Set initial zoom level
    const initialScale = 0.8;
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    const initialTransform = d3.zoomIdentity
      .translate(centerX, centerY)
      .scale(initialScale)
      .translate(-centerX, -centerY);

    this.svg.call(zoom.transform, initialTransform);
    this.g.attr('transform', initialTransform);

    // Create links
    const link = this.g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#999')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1);

    // Create nodes
    const node = this.g.append('g')
      .attr('class', 'nodes')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', (d: any) => sizeScale(d.deviceCount))
      .attr('fill', (d: any) => colorScale(d.riskScore))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer');

    // Add labels for larger nodes
    const labels = this.g.append('g')
      .attr('class', 'labels')
      .selectAll('text')
      .data(nodes) // Show labels for all nodes
      .join('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '.35em')
      .attr('font-size', '8px')
      .attr('font-weight', 'bold')
      .attr('fill', '#333')
      .attr('pointer-events', 'none')
      .text((d: any) => {
        const parts = d.subnet.split('.');
        return parts.length >= 3 ? `${parts[2]}.${parts[3]}` : d.subnet;
      });

    // Add tooltips and interactions
    node
      .on('mouseover', (event: any, d: any) => {
        d3.select(event.currentTarget)
          .attr('stroke-width', 3)
          .attr('stroke', '#007bff');
        
        this.showSubnetTooltip(event, d);
      })
      .on('mouseout', (event: any, d: any) => {
        d3.select(event.currentTarget)
          .attr('stroke-width', 1.5)
          .attr('stroke', '#fff');
        
        this.hideTooltip();
      })
      .on('click', (event: any, d: any) => {
        const subnetData = this.networkData.find(item => item.id === d.id);
        if (subnetData) {
          this.subnetClick.emit(subnetData);
        }
      });

    // Add drag behavior
    node.call(d3.drag()
      .on('start', (event: any, d: any) => this.dragstarted(event, d))
      .on('drag', (event: any, d: any) => this.dragged(event, d))
      .on('end', (event: any, d: any) => this.dragended(event, d)));

    // Update positions on each tick
    this.simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);
      
      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);
      
      labels
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);
    });

    console.log('D3 force-directed graph initialized');
  }

  private transformNetworkDataForD3() {
    const nodes: any[] = [];
    const links: any[] = [];
    
    // Create nodes from network data
    this.networkData.forEach(item => {
      nodes.push({
        id: item.id,
        subnet: item.subnet,
        deviceCount: item.deviceCount,
        riskScore: item.riskScore,
        threatLevel: item.riskLevel,
        isVulnerable: item.isVulnerable
      });
    });
    
    // Create links between subnets in same network
    const networkGroups: { [key: string]: any[] } = {};
    this.networkData.forEach(item => {
      const prefix = item.subnet.split('.').slice(0, 2).join('.');
      if (!networkGroups[prefix]) networkGroups[prefix] = [];
      networkGroups[prefix].push(item);
    });
    
    Object.values(networkGroups).forEach(group => {
      if (group.length > 1) {
        // Create links between nodes in the same network group
        for (let i = 0; i < group.length - 1; i++) {
          for (let j = i + 1; j < Math.min(group.length, i + 4); j++) {
            links.push({
              source: group[i].id,
              target: group[j].id,
              value: 1
            });
          }
        }
      }
    });
    
    return { nodes, links };
  }

  private createLegend(containerWidth: number) {
  const legendContainer = d3.select(this.legendContainer.nativeElement);
  legendContainer.selectAll('*').remove();

  // Detect if mobile/tablet
  const isMobile = window.innerWidth <= 768;
  const isPhone = window.innerWidth <= 480;

  if (isPhone) {
    this.createPhoneLegend(legendContainer, containerWidth);
  } else if (isMobile) {
    this.createMobileLegend(legendContainer, containerWidth);
  } else {
    this.createDesktopLegend(legendContainer, containerWidth);
  }
}

private createDesktopLegend(legendContainer: any, containerWidth: number) {
  const legendWidth = Math.min(300, containerWidth * 0.4);
  const legendBarHeight = 15;

  const legendSvg = legendContainer.append('svg')
    .attr('width', legendWidth + 120)
    .attr('height', 80)
    .style('display', 'block')
    .style('margin', '0 auto')
    .style('transform', 'translateX(-20%)');

  // Legend title
  legendSvg.append('text')
    .attr('x', (legendWidth + 120) / 2)
    .attr('y', 12)
    .attr('text-anchor', 'middle')
    .attr('font-size', '12px')
    .attr('font-weight', 'bold')
    .attr('fill', '#333')
    .text('Risk Score');

  this.createLegendContent(legendSvg, legendWidth, legendBarHeight, 60, 'Red Nodes indicate High-Risk subnets | Hover for details | Click to explore devices');
}

private createMobileLegend(legendContainer: any, containerWidth: number) {
  const legendWidth = Math.min(250, containerWidth * 0.6);
  const legendBarHeight = 12;

  const legendSvg = legendContainer.append('svg')
    .attr('width', legendWidth + 80)
    .attr('height', 65)
    .style('display', 'block')
    .style('margin', '0 auto');

  // Legend title
  legendSvg.append('text')
    .attr('x', (legendWidth + 80) / 2)
    .attr('y', 12)
    .attr('text-anchor', 'middle')
    .attr('font-size', '11px')
    .attr('font-weight', 'bold')
    .attr('fill', '#333')
    .text('Risk Score');

  this.createLegendContent(legendSvg, legendWidth, legendBarHeight, 40, 'Red = High Risk | Tap to explore');
}

private createPhoneLegend(legendContainer: any, containerWidth: number) {
  const legendWidth = Math.min(200, containerWidth * 0.8);
  const legendBarHeight = 10;

  const legendSvg = legendContainer.append('svg')
    .attr('width', legendWidth + 60)
    .attr('height', 55)
    .style('display', 'block')
    .style('margin', '0 auto');

  // Legend title
  legendSvg.append('text')
    .attr('x', (legendWidth + 60) / 2)
    .attr('y', 10)
    .attr('text-anchor', 'middle')
    .attr('font-size', '10px')
    .attr('font-weight', 'bold')
    .attr('fill', '#333')
    .text('Risk Score');

  this.createLegendContent(legendSvg, legendWidth, legendBarHeight, 30, 'Tap nodes to explore');
}

private createLegendContent(legendSvg: any, legendWidth: number, legendBarHeight: number, xOffset: number, instructionText: string) {
  // Create color scale
  const colorScale = d3.scaleLinear()
    .domain([0, 2, 4, 6, 8, 10])
    .range(['#00e676', '#4caf50', '#ffeb3b', '#ff9800', '#ff5722', '#ff0000']);

  // Create gradient
  const defs = legendSvg.append('defs');
  const gradient = defs.append('linearGradient')
    .attr('id', 'risk-gradient')
    .attr('x1', '0%')
    .attr('x2', '100%');

  const stops = [0, 20, 40, 60, 80, 100];
  stops.forEach((percent, i) => {
    gradient.append('stop')
      .attr('offset', `${percent}%`)
      .attr('stop-color', colorScale(i * 2));
  });

  // Draw legend bar
  legendSvg.append('rect')
    .attr('x', xOffset)
    .attr('y', 20)
    .attr('width', legendWidth)
    .attr('height', legendBarHeight)
    .style('fill', 'url(#risk-gradient)')
    .style('stroke', '#999')
    .style('stroke-width', 1);

  // Add scale labels
  const scaleLabels = [0, 2, 4, 6, 8, 10];
  scaleLabels.forEach((value, i) => {
    const x = xOffset + (i * legendWidth / 5);
    legendSvg.append('text')
      .attr('x', x)
      .attr('y', 20 + legendBarHeight + 15)
      .attr('text-anchor', 'middle')
      .attr('font-size', window.innerWidth <= 480 ? '8px' : '10px')
      .attr('fill', '#666')
      .text(value.toString());
  });

  // Add instructions text
  legendSvg.append('text')
    .attr('x', xOffset + (legendWidth / 2))
    .attr('y', 20 + legendBarHeight + 30)
    .attr('text-anchor', 'middle')
    .attr('font-size', window.innerWidth <= 480 ? '9px' : '11px')
    .attr('fill', '#666')
    .text(instructionText);
}

  // Drag functions
  private dragstarted(event: any, d: any) {
    if (!event.active) this.simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  private dragged(event: any, d: any) {
    d.fx = event.x;
    d.fy = event.y;
  }

  private dragended(event: any, d: any) {
    if (!event.active) this.simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  private showSubnetTooltip(event: any, d: any) {
    // Remove any existing tooltips
    d3.selectAll('.tooltip').remove();

    const tooltip = d3.select('body').append('div')
      .attr('class', 'tooltip')
      .style('opacity', 0)
      .style('position', 'absolute')
      .style('background', 'rgba(0, 0, 0, 0.8)')
      .style('color', 'white')
      .style('padding', '10px')
      .style('border-radius', '5px')
      .style('pointer-events', 'none')
      .style('font-size', '12px')
      .style('z-index', '1000');

    tooltip.html(`
      <strong>${d.subnet}</strong><br>
      <strong>Devices:</strong> ${d.deviceCount}<br>
      <strong>Risk Score:</strong> ${d.riskScore.toFixed(1)}<br>
      <strong>Threat Level:</strong> ${d.threatLevel}
      ${d.isVulnerable ? '<br><strong style="color: #ff6b6b;">⚠ VULNERABLE</strong>' : ''}
    `)
    .style('left', (event.pageX + 10) + 'px')
    .style('top', (event.pageY - 10) + 'px')
    .transition()
    .duration(200)
    .style('opacity', 1);
  }

  private hideTooltip() {
    d3.selectAll('.tooltip').remove();
  }

  onSearchChange() {
    // Filter nodes based on search term
    if (this.nodes && this.svg) {
      const searchLower = this.searchTerm.toLowerCase();
      
      this.svg.selectAll('.nodes circle')
        .style('opacity', (d: any) => {
          if (!this.searchTerm) return 1;
          return d.subnet.toLowerCase().includes(searchLower) ? 1 : 0.3;
        });

      this.svg.selectAll('.labels text')
        .style('opacity', (d: any) => {
          if (!this.searchTerm) return 1;
          return d.subnet.toLowerCase().includes(searchLower) ? 1 : 0.3;
        });
    }
  }
}