import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfiguracionComponent } from './configuracion';

describe('ConfiguracionComponent', () => {
  let component: ConfiguracionComponent;
  let fixture: ComponentFixture<ConfiguracionComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ConfiguracionComponent] }).compileComponents();
    fixture = TestBed.createComponent(ConfiguracionComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });
  it('should create', () => { expect(component).toBeTruthy(); });
});