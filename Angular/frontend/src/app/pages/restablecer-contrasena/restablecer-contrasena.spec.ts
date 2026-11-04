import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RestablecerContrasenaComponent } from './restablecer-contrasena';

describe('RestablecerContrasenaComponent', () => {
  let component: RestablecerContrasenaComponent;
  let fixture: ComponentFixture<RestablecerContrasenaComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RestablecerContrasenaComponent] }).compileComponents();
    fixture = TestBed.createComponent(RestablecerContrasenaComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });
  it('should create', () => { expect(component).toBeTruthy(); });
});
