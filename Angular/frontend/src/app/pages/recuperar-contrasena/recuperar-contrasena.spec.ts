import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecuperarContrasenaComponent } from './recuperar-contrasena';

describe('RecuperarContrasenaComponent', () => {
  let component: RecuperarContrasenaComponent;
  let fixture: ComponentFixture<RecuperarContrasenaComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RecuperarContrasenaComponent] }).compileComponents();
    fixture = TestBed.createComponent(RecuperarContrasenaComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });
  it('should create', () => { expect(component).toBeTruthy(); });
});
